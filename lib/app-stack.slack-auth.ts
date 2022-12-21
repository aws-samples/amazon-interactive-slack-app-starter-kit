/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { App, AwsLambdaReceiver, LogLevel } from '@slack/bolt'
import { SecretsManager } from 'aws-sdk'

const secretsClient = new SecretsManager()

let awsLambdaReceiver: AwsLambdaReceiver | null = null
let app: App | null = null
let requestDetails: RequestDetails | null = null

type RequestDetails = {
  channelId: string
  userName: string
  action: string
  actionBase?: string
  responseUrl: string
  inputValue?: string
}

exports.handler = async (event: any, context: any, callback: any) => {
  requestDetails = null
  if (!awsLambdaReceiver) {
    await initBolt()
    configureApp(callback)
  }
  const handler = await awsLambdaReceiver!.start()
  const response = await handler(event, context, callback)

  if (response.statusCode != 200) {
    throw new Error('Failed to validate slack message')
  }

  return requestDetails
}

async function initBolt() {
  // Get the Slack Secrets
  const secretResult = await secretsClient.getSecretValue({ SecretId: process.env.SLACK_SECRETS_NAME as string }).promise()
  const secretObject = JSON.parse(secretResult.SecretString!)

  awsLambdaReceiver = new AwsLambdaReceiver({
    signingSecret: secretObject.signingSecret
  })

  app = new App({
    token: secretObject.botToken,
    receiver: awsLambdaReceiver,
    logLevel: LogLevel.DEBUG
  })
}

function configureApp(callback: any) {
  if (!app) {
    throw Error('Bolt app not initialized while trying to configure it')
  }

  // @ts-ignore
  app.use(async ({ body, ack, next }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await ack!()

    // Convert body to a consistent format
    requestDetails = parseRequest(body)
  })
}

function parseRequest(body: any): RequestDetails {
  if (body.user_id) {
    return {
      channelId: body.channel_id,
      userName: body.user_name,
      action: 'welcome',
      responseUrl: body.response_url
    }
  } else {
    return {
      channelId: body.channel.id,
      userName: body.user.username,
      action: body.actions[0].action_id,
      actionBase: body.actions[0].action_id.split('/')[0],
      responseUrl: body.response_url,
      inputValue: body.state?.values?.form_input?.input_value?.value ?? null
    }
  }
}
