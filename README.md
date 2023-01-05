## Amazon Interactive Slack App Starter Kit

This starter kit will help you started with building an interactive Slack app leveraging CDK. More details about why to use the solution in this repository may be found in this [blog post](TODO). Additionally, the linked blog post contains information on how to configure your Slack Application to work with this solution.

## Architecture

![Interactive Slack App Architecture](docs/slack_app_architecture.jpg?raw=true "Architecture")

## Prerequisites
* AWS CDK (https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install) version 2.19.0 or later
* Node (https://nodejs.org/en/download/current/) version 16+
* Docker-cli (https://docs.docker.com/get-docker/)
* Git (https://git-scm.com/download)

## Deployment Instructions
1. Install dependencies using `npm install`
1. Bootstrap your AWS environment using `cdk bootstrap`
1. Deploy AWS resources using `cdk deploy`

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
* `cdk destroy`     removes all stack resources

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
