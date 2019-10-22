const path = require('path');
const ZipPlugin = require('zip-webpack-plugin');

module.exports = {
    entry: path.join(__dirname, 'src', 'index.ts'),
    node: {
        // Allow these globals.
        __filename: false,
        __dirname: false,
        Base64: false
    },
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'commonjs2'
    },
    bail: true,
    resolve: {
        extensions: ['.ts', '.tsx', '.js']
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [['@babel/env', {targets: {node: '10.16'}}]],
                            plugins: [],
                            compact: false,
                            babelrc: false,
                            cacheDirectory: true
                        }
                    }
                ]
            },
            {
                test: /\.ts(x?)$/,
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [['@babel/env', {targets: {node: '10.16'}}]],
                            plugins: [],
                            compact: false,
                            babelrc: false,
                            cacheDirectory: true
                        }
                    },
                    'ts-loader'
                ]
            },
            {
                test: /\.jpe?g$|\.gif$|\.png$|\.svg$|\.woff$|\.ttf$|\.wav$|\.mp3$/,
                use: [
                    'file-loader'
                ]
            }
        ]
    },
    plugins: [
        new ZipPlugin({
            path: path.join(__dirname, 'dist'),
            pathPrefix: "",
            filename: `dist.zip`
        })
    ],
    target: 'node',
    externals: {
        // These modules are already installed on the Lambda instance.
        'aws-sdk': 'aws-sdk',
        'awslambda': 'awslambda',
        'dynamodb-doc': 'dynamodb-doc',
        'imagemagick': 'imagemagick'
    }
};
