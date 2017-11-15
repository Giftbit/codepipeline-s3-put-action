import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as index from "./index";
import {S3} from "aws-sdk";
import {CodePipelineJob, CodePipelineS3Location} from "./CodePipelineEvent";
import {S3PutConfiguration} from "./S3PutCodePipelineConfiguration";
import * as sinon from "sinon";

chai.use(chaiAsPromised);

describe("create-change-set-s3", () => {
    describe("getS3PutConfigurationFromJob()", () => {
        it("Returns an S3PutCodePipelineConfiguration object", () => {
            const changeSetCreateConfiguration = index.getS3PutConfigurationFromJob(sampleJob);

            const expected : S3PutConfiguration = {
                ObjectPath: "ArtifactName::template.yaml",
                BucketName: "MyBucket",
                ObjectKey: "templates/template-${ArtifactName::build.json::version}.yaml"
            };

            chai.assert.deepEqual(changeSetCreateConfiguration, expected);
        });
    });

    describe("getS3LocationForInputArtifact", () => {
        it("Returns locations for artifacts if they exist", () => {
            const s3Location = index.getS3LocationForInputArtifact("ArtifactName", sampleJob);

            const expected: CodePipelineS3Location = {
                bucketName: "inputBucket",
                objectKey: "inputArtifact.zip"
            };

            chai.assert.deepEqual(s3Location, expected);
        });

        it("Returns null for artifacts that don't exist", () => {
            const s3Location = index.getS3LocationForInputArtifact("FakeArtifactName", sampleJob);

            const expected: CodePipelineS3Location = null;

            chai.assert.deepEqual(s3Location, expected);
        })
    });

    describe("resolveObjectKey()", () => {
        let s3GetObjectStub: any;

        beforeEach(() => {
            s3GetObjectStub = sinon.stub(index.s3,"getObject");
        });

        afterEach(() => {
            s3GetObjectStub.restore();
        });

        it("Returns the original string if it doesn't contain replacements", async () => {
            const objectKey = "templates/somefile.yaml";

            const resolvedObjectKey = await index.resolveObjectKey(objectKey, null);

            chai.assert.equal(resolvedObjectKey, objectKey);
        });

        it("Resolves the actual value for strings with replacement values", async () => {
            const objectKey = "templates/template-${ArtifactName::build.json::version}.yaml";

            s3GetObjectStub.callsFake(fakeS3Call);

            const expected = "templates/template-1.yaml";

            const resolvedObjectKey = await index.resolveObjectKey(objectKey, sampleJob);

            chai.assert.equal(resolvedObjectKey, expected);
        });

        it("Rejects if the key contains an artifact name not in the job", async () => {
            const objectKey = "templates/template-${FakeArtifactName::build.json::version}.yaml";

            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.resolveObjectKey(objectKey, sampleJob);

            chai.assert.isRejected(promise);
        });

        it("Rejects if the key contains a file name not in the artifact", async () => {
            const objectKey = "templates/template-${ArtifactName::fakefile.json::version}.yaml";

            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.resolveObjectKey(objectKey, sampleJob);

            chai.assert.isRejected(promise);
        });

        it("Rejects if the key contains an attribute reference for an attribute of the file that doesn't exist", async () => {
            const objectKey = "templates/template-${ArtifactName::build.json::fakeattribute}.yaml";

            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.resolveObjectKey(objectKey, sampleJob);

            chai.assert.isRejected(promise);
        });
    });

    describe("getBodyFromZippedS3Object()", () => {

        let s3GetObjectStub: any;

        beforeEach(() => {
            s3GetObjectStub = sinon.stub(index.s3,"getObject");
        });

        afterEach(() => {
            s3GetObjectStub.restore();
        });

        it("returns the body for a file that exists", async () => {
            s3GetObjectStub.callsFake(fakeS3Call);

            const expected = '{\n\t"version": "1"\n}';

            const body = await index.getBodyFromZippedS3Object("inputBucket","inputArtifact.zip","build.json");

            chai.assert.equal(body.toString("utf-8"), expected);
        });

        it("Rejects if the bucket doesn't exist", async () => {
            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.getBodyFromZippedS3Object("badBucket","inputArtifact.zip","build.json");
            await chai.assert.isRejected(promise);
        });

        it("Rejects if the object with key doesn't exist", async () => {
            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.getBodyFromZippedS3Object("inputBucket","badInputArtifact.zip","build.json");
            await chai.assert.isRejected(promise);
        });

        it("Rejects if the file requested doesn't exist in the zip", async () => {
            s3GetObjectStub.callsFake(fakeS3Call);

            // The following value is a base64 encoded version a zip file containing a file called build.json which has a json object with a version of 1
            const promise = index.getBodyFromZippedS3Object("inputBucket","inputArtifact.zip","badBuild.json");

            await chai.assert.isRejected(promise);
        });
    });

    describe("copyArtifactResourceToS3()", () => {
        let s3GetObjectStub: any;
        let s3PutObjectStub: any;

        beforeEach(() => {
            s3GetObjectStub = sinon.stub(index.s3,"getObject");
            s3PutObjectStub = sinon.stub(index.s3,"putObject");
        });

        afterEach(() => {
            s3GetObjectStub.restore();
            s3PutObjectStub.restore();
        });

        it("Copies the buffer correctly", async () => {
            const zippedBuildJsonBuffer = new Buffer("UEsDBAoAAAAAAPVSaEu6OgV9EwAAABMAAAAKABwAYnVpbGQuanNvblVUCQADrksDWrNLA1p1eAsAAQT1AQAABBQAAAB7CgkidmVyc2lvbiI6ICIxIgp9UEsBAh4DCgAAAAAA9VJoS7o6BX0TAAAAEwAAAAoAGAAAAAAAAQAAAKSBAAAAAGJ1aWxkLmpzb25VVAUAA65LA1p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAEAAQBQAAAAVwAAAAAA","base64")

            s3GetObjectStub.callsFake(fakeS3Call);

            s3PutObjectStub.callsFake((request: S3.Types.PutObjectRequest) => {
                return {
                    promise: () => {
                        return new Promise((resolve, reject) => {
                            if (request.Bucket && request.Key && request.Body) {
                                resolve();
                            }
                            else {
                                reject();
                            }
                        });
                    }
                }
            });

            await index.copyArtifactResourceToS3("ArtifactName::build.json", "destination-bucket", "destination.json", sampleJob);

            const expected = [{
                Body: Buffer.from('{\n\t"version": "1"\n}'),
                Bucket: "destination-bucket",
                Key: "destination.json"
            }];


            chai.assert.deepEqual(s3PutObjectStub.getCall(0).args, expected);
        });

        it("Rejects if the Artifact Identifier doesn't represent an artifact-file combination", async () => {
            const promise = index.copyArtifactResourceToS3("ArtifactName", "destination-bucket", "destination.json", sampleJob);

            chai.assert.isRejected(promise);
        });


        it("Rejects if the Artifact name doesn't exist on the job", async () => {
            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.copyArtifactResourceToS3("FakeArtifactName::build.json", "destination-bucket", "destination.json", sampleJob);

            chai.assert.isRejected(promise);
        });

        it("Rejects if the Artifact Identifier doesn't represent an artifact-file combination", async () => {
            s3GetObjectStub.callsFake(fakeS3Call);

            const promise = index.copyArtifactResourceToS3("ArtifactName::fakebuild.json", "destination-bucket", "destination.json", sampleJob);

            chai.assert.isRejected(promise);
        });
    });
});

function fakeS3Call (request: S3.Types.GetObjectRequest) {
    return {
        promise: () => {
            return new Promise((resolve, reject) => {
                if (request.Bucket != "inputBucket" || request.Key != "inputArtifact.zip") {
                    reject("File not found");
                    return
                }

                const fakeS3Object: S3.Types.GetObjectOutput = {
                    Body: new Buffer("UEsDBAoAAAAAAPVSaEu6OgV9EwAAABMAAAAKABwAYnVpbGQuanNvblVUCQADrksDWrNLA1p1eAsAAQT1AQAABBQAAAB7CgkidmVyc2lvbiI6ICIxIgp9UEsBAh4DCgAAAAAA9VJoS7o6BX0TAAAAEwAAAAoAGAAAAAAAAQAAAKSBAAAAAGJ1aWxkLmpzb25VVAUAA65LA1p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAEAAQBQAAAAVwAAAAAA","base64")
                };

                resolve(fakeS3Object);
            });
        }
    };
}

const sampleJob: CodePipelineJob = {
    "id": "11111111-abcd-1111-abcd-111111abcdef",
    "accountId": "111111111111",
    "data": {
        "actionConfiguration": {
            "configuration": {
                "FunctionName": "MyLambdaFunctionForAWSCodePipeline",
                "UserParameters": '{' +
                    '"ObjectPath": "ArtifactName::template.yaml",' +
                    '"BucketName": "MyBucket",' +
                    '"ObjectKey": "templates/template-${ArtifactName::build.json::version}.yaml"' +
                '}'
            }
        },
        "inputArtifacts": [
            {
                "location": {
                    "s3Location": {
                        "bucketName": "inputBucket",
                        "objectKey": "inputArtifact.zip"
                    },
                    "type": "S3"
                },
                "revision": "1",
                "name": "ArtifactName"
            }
        ],
        "outputArtifacts": [
            {
                "location": {
                    "s3Location": {
                        "bucketName": "outputBucket",
                        "objectKey": "outputArtifact.zip"
                    },
                    "type": "S3"
                },
                "revision": "1",
                "name": "OutputName"
            }
        ],
        "artifactCredentials": {
            "secretAccessKey": "",
            "sessionToken": "",
            "accessKeyId": ""
        },
        "continuationToken": "A continuation token if continuing job"
    }
};