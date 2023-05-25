# Amazon Interactive Slack App Starter Kit

This starter kit will help you started with building an interactive Slack app leveraging CDK. More details about why to use the solution in this repository may be found in this [blog post](https://aws.amazon.com/blogs/compute/developing-a-serverless-slack-app-using-aws-step-functions-and-aws-lambda/).

This README will guide you to configure this solution with your own AWS account.

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deployment Instructions](#deployment-instructions)
  - [1. Request Slack App Token](#1-request-slack-app-token)
  - [2. Clone this repository](#2-clone-this-repository)
  - [3. Bootstrap AWS Environment](#3-bootstrap-aws-environment)
  - [4. Build and deploy serverless resources](#4-build-and-deploy-serverless-resources)
  - [5. Configure resources with Slack App secrets and Slack users](#5-configure-resources-with-slack-app-secrets-and-slack-users)
  - [6. Register slash command to invoke Slack App](#6-register-slash-command-to-invoke-slack-app)
  - [7. Register Interactivity URL (pointing to API Gateway)](#7-register-interactivity-url-pointing-to-api-gateway)
- [Testing Instructions](#testing-instructions)
- [Destroying Resources](#destroying-resources)
- [Useful Commands](#useful-commands)
- [Security](#security)
- [License](#license)

## Architecture

![Interactive Slack App Architecture](docs/slack_app_architecture.jpg?raw=true "Architecture")

## Prerequisites
* [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install) version 2.19.0 or later
* [Node](https://nodejs.org/en/download/current/) version 16+
* [Docker-cli](https://docs.docker.com/get-docker/)
* [Git](https://git-scm.com/download)
* A personal or company Slack account with permissions to create applications
* The Slack Channel ID of a channel in your Workspace for integration with the Slack App
  * To get the Channel ID, open the context menu on the Slack channel and select View channel details. The modal displays your Channel ID at the bottom:

     ![Slack Channels](docs/slack_channels.png?raw=true "Slack Channel")

     ![Slack Channel Modal](docs/slack_channel_modal.png?raw=true "Slack Channel Modal")

    To learn more, visit Slack's [Getting Started with Bolt for JavaScript](https://slack.dev/bolt-js/tutorial/getting-started) page.

---

## Deployment Instructions

### 1. Request Slack App Token
To create the Slack App within your Slack Workspace, navigate to Slack's [Your Apps](https://api.slack.com/apps) page and choose the **Create New App** button.

Select the _From scratch_ option within the _Create an app_ dialog:

![Create an app dialog](docs/1_create_slack_app.png?raw=true "Create an app dialog")

Enter a name for your Slack App and your Workspace, then choose **Create App**:

![Name app & choose workspace dialog](docs/1_name_slack_app.png?raw=true "Name app & choose workspace dialog")

You see the configuration page for your new Slack App.
 
![Configuration page](docs/1_configure_slack_app.png?raw=true "Configuration page")

To add permissions to your Slack App using _OAuth scopes_, navigate to the **OAuth & Permissions** sidebar and scroll to the _Bot Token Scopes_ section. Choose **Add an OAuth Scope** and add the `chat:write` and `commands` _OAuth scopes_.
 
![Bot Token Scopes](docs/1_slack_bot_scopes.png?raw=true "Bot Token Scopes")

Install the Slack App to your Workspace to generate a Slack Bot token. Navigate to the **Basic Information** sidebar, then choose **Install to Workspace**.

From the _Application installation verification_ page, choose **Allow** to complete the installation.
 
![Application installation verification](docs/1_installation_verification.png?raw=true "Application installation verification")

After installation, the configuration page for your Slack App shows a _Success_ banner. Navigate back to the **OAuth & Permissions** sidebar to view your Slack App token.

![OAuth & Permissions page](docs/1_slack_app_permissions.png?raw=true "OAuth & Permissions page")

To learn more about Token Types, visit Slack's [Access tokens](https://api.slack.com/authentication/token-types#bot) page.

### 2. Clone this repository
From a command prompt on your computer, clone this repository in a directory of your choice:

```bash
git clone https://github.com/aws-samples/amazon-interactive-slack-app-starter-kit.git
```

Within the `/lib` directory, the `app-stack.ts` file outlines all the resources to be deployed. Additionally, using `NodeJsFunction` resources enables full TypeScript transpiling and bundling for a Lambda function.

Download the project dependencies using the NPM install command:

```bash
npm install
```

### 3. Bootstrap AWS Environment

Before you deploy the CDK resources to your AWS account, bootstrap the AWS environment in the AWS Region of your choice with this command:

```bash
cdk bootstrap
```

By running the preceding command, you prepare your AWS account and AWS Region with resources to perform deployments. You only need to bootstrap your AWS account and AWS Region once.

### 4. Build and deploy serverless resources
Now that you have the code base cloned and the AWS environment configured, it’s time to deploy the AWS resources. 

You will run the following command from the root of the project to start the deployment. Ensure you have docker running as it will bundle your Lambda resources.

```bash
cdk deploy
```

**Note:** You may specify a target Region using the argument `--region <region_name>`

You must accept the security changes being made to your account because of the new resources being deployed.

Once the deployment completes, observe the output from `cdk deploy` which looks like:

```bash
AmazonInteractiveSlackAppStarterKitStack: creating CloudFormation changeset...

 ✅  AmazonInteractiveSlackAppStarterKitStack

✨  Deployment time: 158.28s

Outputs:
AmazonInteractiveSlackAppStarterKitStack.SlackAppApiEndpointXXXX = https://XXXXXXXX.execute-api.us-east-1.amazonaws.com/prod/
Stack ARN:
arn:aws:cloudformation:us-east-1:XXXXXXXXXX:stack/AmazonInteractiveSlackAppStarterKitStack/123e4567-e89b-12d3-a456-426652340000

✨  Total time: 173.81s
```

**Note:** Record the API Gateway URL generated from your deployment as it is needed for registration with the Slack App configuration later on.

### 5. Configure resources with Slack App secrets and Slack users
With the CDK resources deployed, you need to configure the newly generated SSM Parameter and Secrets Parameter with your specific application values.

To update the SSM Parameter containing the Slack channel ID, perform the following steps:

1. Go to the [Parameter Store console](https://console.aws.amazon.com/systems-manager/parameters/?region=us-east-1&tab=Table) for your Region

1. Choose the parameter with the name **SlackChannelIdParameter**

1. Choose the **Edit** button

1. Enter your Channel ID from the prerequisites section into the **Value** text field.

1. Choose the **Save changes** button

Next, you must update the Secrets Parameter containing the OAuth token and signing secret for your Slack app using the following steps:

1. Go to the [Secrets Manager console](https://console.aws.amazon.com/secretsmanager/listsecrets) for your Region

1. Choose the secret starting with **SlackSecretsXXXXXXXX**

1. Select the **Retrieve secret value** button to reveal the secret’s details

1. Choose the **Edit** button

1. Select the **Plaintext** tab, and enter the following value. Be sure to substitute your own values where appropriate

    `{"signingSecret":"<your_signing_secret>","botToken":"<your_bot_token>"}`

1. Choose the **Save** button after finishing with your changes

Lastly, configure your slack user to have permissions to invoke the Slack App.

To configure your Slack user, proceed with the following steps:

1. Navigate to your account settings for your organization’s Slack account. The URL will look like:

    `https://<your-organization>.slack.com/account/settings#username`

1. Copy the value under **Username** as this is needed in the next few steps

1. Go to [DynamoDB Tables console](https://console.aws.amazon.com/dynamodbv2/home#tables) and be sure to choose the correct Region to which you deployed your resources.

1. Choose the **AmazonInteractiveSlackAppStarterKitStack-BotUsersTableXXXXXXX**

1. Select the **Explore table items** button

1. Select the **Create item** button

1. Choose the JSON view option in the top right corner

1. In the **Attributes** text entry, provide the following. Be sure to substitute your own values where appropriate.

    ```json
    {
      "slackUserName": "<your_slack_username>",
      "permittedActions": [
        "sample-lambda",
        "sample-sm"
      ]
    }
    ```

9. To save, choose the **Create item** button

Your Slack user now has the permissions to run commands to invoke the Slack App.

### 6. Register slash command to invoke Slack App
Now, you must create an _entry point_ for your Slack App by registering a **Slash Command** for your Slack App. The _Slash Command_ is a keyword which informs Slack to invoke a specific function of your backend application. For this exercise, register the _Slash Command_, `/my-slack-bot`.

To register the `/my-slack-bot` _Slash Command_, navigate to the _Application Configuration_ page for your Slack App:

https://api.slack.com/apps > My Slack Bot.

Go to the _Slash Commands_ sidebar, then choose the _Create New Command_ button:

![Slash Commands page](docs/6_slash_commands.png?raw=true "Slash Commands page")

Complete the _Create New Command_ registration form. For the text field labeled _Request URL_, enter the API Gateway URL created from the deployment of your serverless resources from the preceding section. Note that this URL must follow the pattern `https://<apigw-id>.execute-api.<aws-region>.amazonaws.com/<stage>/slack/events`, as the Slack Bolt SDK binds to the `/slack/events` endpoint:

![Create New Command form](docs/6_create_new_command.png?raw=true "Create New Command form")

Once completed, select the _Save_ button. Upon creation, your browser is returned to the _Slash Commands_ configuration page for your Slack App with a _Success_ banner at the top of the page:

![Slash Commands page](docs/6_added_slash_command.png?raw=true "Slash Commands page")

To learn more about Slash Commands, visit Slack's [Enabling interactivity with Slash Commands](https://api.slack.com/interactivity/slash-commands) page.

### 7. Register Interactivity URL (pointing to API Gateway)
With the _entry point_ for your Slack App configured, you must now configure your Slack workspace to interact with your backend application. Since your Slack App supports actions _beyond_ the invocation stage, you need to inform Slack to direct subsequent interactivity to the backend. You must register your backend API with your Slack App's _Interactivity & Shortcuts_ configuration.

Navigate to the _Application Configuration_ page for your Slack App:

https://api.slack.com/apps > My Slack Bot.

Go to the **Interactivity & Shortcuts** sidebar and enable interactivity by choosing the _Interactivity_ toggle:

![Interactivity toggle](docs/7_interactivity_toggle.png?raw=true "Interactivity toggle")

For the text field labeled _Request URL_, enter the API Gateway URL created from the deployment of your serverless resources. Note that this URL must follow the pattern `https://<apigw-id>.execute-api.<aws-region>.amazonaws.com/<stage>/slack/events`, as the Slack Bolt SDK binds to the `/slack/events` endpoint:

![Interactivity form](docs/7_interactivity_form.png?raw=true "Interactivity form")

Once entered, choose the _Save Changes_ button. Upon creation, a _Success_ banner appears at the top of the page.

## Testing Instructions
1. Start the Slack App by invoking the `/my-slack-bot` slash command

    ![Invoke Slash Command](docs/test_step_1.png?raw=true "Invoke Slash Command")

1. From the My Slack Bot action menu, select **Sample Lambda**

    ![Select Sample Lambda](docs/test_step_2.png?raw=true "Select Sample Lambda")

1.	Enter command input, select **Submit** button, then observe the response (this input value applies to the sample Lambda function)

    ![Select Submit Button](docs/test_step_3.png?raw=true "Select Submit Button")

1. Observe the execution output posted to the Slack channel

    ![Observe Output](docs/test_step_4.png?raw=true "Observe Output")

**Note**: You can test the State Machine execution by selecting **Sample State Machine** in step #2

## Destroying Resources
To avoid additional charges to your account, run the following command from the project’s root directory:

```bash
cdk destroy
```

CDK prompts you to confirm if you want to delete the resources. Enter “y” to confirm. The process removes all the resources created.

---

## Useful Commands

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
