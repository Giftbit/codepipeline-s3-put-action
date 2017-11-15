import "babel-polyfill";
import * as AWS from "aws-sdk";
import * as awslambda from "aws-lambda";
import {CodePipelineEvent, CodePipelineJob, CodePipelineS3Location} from "./CodePipelineEvent";
import {S3PutConfiguration} from "./S3PutCodePipelineConfiguration";
import * as JSZip from "jszip";

export let s3 = new AWS.S3();
export let codepipeline = new AWS.CodePipeline();

//noinspection JSUnusedGlobalSymbols
export function handler(event: CodePipelineEvent, context: awslambda.Context, callback: awslambda.Callback): void {
    console.log("event", JSON.stringify(event, null, 2));
    handlerAsync(event, context)
        .then(res => {
            callback(undefined, res);
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(event: CodePipelineEvent, context: awslambda.Context): Promise<any> {
    try {
        const job: CodePipelineJob = event["CodePipeline.job"];
        const s3PutConfiguration: S3PutConfiguration = getS3PutConfigurationFromJob(job);
        const resolvedObjectKey = await resolveObjectKey(s3PutConfiguration.ObjectKey, job);

        await copyArtifactResourceToS3(s3PutConfiguration.ObjectPath, s3PutConfiguration.BucketName, resolvedObjectKey, job);
        await codepipeline.putJobSuccessResult({
            jobId: job.jobId
        }).promise();
    }
    catch (err) {
        await codepipeline.putJobFailureResult({
            jobId: job.jobId,
            failureDetails: {
                type: "JobFailed",
                message: err.message,
                externalExecutionId: context.awsRequestId
            }
        }).promise();
        return;
    }
}

export function getS3PutConfigurationFromJob(job: CodePipelineJob): S3PutConfiguration {
    return JSON.parse(job.data.actionConfiguration.configuration.UserParameters) as S3PutConfiguration;
}

export function getS3LocationForInputArtifact(artifactName: string, job:CodePipelineJob): CodePipelineS3Location {
    const artifact = job.data.inputArtifacts.find((artifact) => artifact.name == artifactName);

    if (artifact) {
        return artifact.location.s3Location
    }
    return null;
}

export async function resolveObjectKey(objectKey: string, job: CodePipelineJob): Promise<string> {
    const matches = objectKey.match(/\${([^:]+)::([^}:]+)(::([^}]+))?}/);
    if (matches) {
        const artifactName = matches[1];
        const fileName = matches[2];
        const jsonKey = matches[4];

        const s3Location = getS3LocationForInputArtifact(artifactName, job);
        if (! s3Location) {
            throw new Error(`Invalid resource for key '${objectKey}'`);
        }

        const fileBody = await getBodyFromZippedS3Object(s3Location.bucketName, s3Location.objectKey, fileName);
        if (! fileBody) {
            throw new Error(`Invalid resource for key '${objectKey}'`);
        }

        if (!jsonKey) {
            return fileBody.toString('utf-8');
        }

        const fileJson = JSON.parse(fileBody.toString('utf-8'));
        const value = fileJson[jsonKey];

        if (!value) {
            throw new Error (`Invalid resource for key '${objectKey}`);
        }

        return objectKey.replace(matches[0], value);
    }
    return objectKey;
}

export async function getBodyFromZippedS3Object(bucketName: string, key: string, filename: string): Promise<Buffer> {
    const params = {
        Bucket: bucketName,
        Key: key
    };

    const s3Object = await s3.getObject(params).promise();

    const zip = new JSZip();
    await zip.loadAsync(s3Object.Body as Buffer);
    const file = zip.file(filename);

    if (!file) {
        throw new Error(`Unable to get file from artifact object. File '${filename}' was not found.`)
    }

    return await file.async('nodebuffer');
}

export async function copyArtifactResourceToS3(objectPath: string, destinationBucketName: string, destinationObjectKey: string, job: CodePipelineJob): Promise<void> {
    const matches = objectPath.match(/^([^:]+)::(.+)$/);
    if (!matches) {
        throw new Error (`Unable to resolve resource artifact location from '${objectPath}'`);
    }

    const artifactName = matches[1];
    const fileName = matches[2];

    const s3Location = getS3LocationForInputArtifact(artifactName, job);
    if (! s3Location) {
        throw new Error(`Invalid resource for key '${objectPath}`);
    }

    const fileBody = await getBodyFromZippedS3Object(s3Location.bucketName, s3Location.objectKey, fileName);
    if (! fileBody) {
        throw new Error(`Invalid resource for key '${objectPath}'`);
    }

    const putParams = {
        Body: fileBody,
        Bucket: destinationBucketName,
        Key: destinationObjectKey
    };

    await s3.putObject(putParams).promise();
}
