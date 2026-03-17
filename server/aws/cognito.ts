import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AuthFlowType,
  MessageActionType,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || "eu-central-1",
});

const userPoolId = process.env.COGNITO_USER_POOL_ID!;
const clientId = process.env.COGNITO_CLIENT_ID!;

export interface CognitoUser {
  username: string;
  email: string;
  sub: string;
}

export async function authenticateUser(email: string, password: string): Promise<{ accessToken: string; idToken: string; refreshToken: string }> {
  if (!userPoolId || !clientId) {
    throw new Error("Cognito is not configured. Please set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID environment variables.");
  }

  const command = new AdminInitiateAuthCommand({
    UserPoolId: userPoolId,
    ClientId: clientId,
    AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  const response = await client.send(command);
  
  if (!response.AuthenticationResult) {
    throw new Error("Authentication failed");
  }

  return {
    accessToken: response.AuthenticationResult.AccessToken!,
    idToken: response.AuthenticationResult.IdToken!,
    refreshToken: response.AuthenticationResult.RefreshToken!,
  };
}

export async function createCognitoUser(email: string, password: string, name: string): Promise<string> {
  if (!userPoolId) {
    throw new Error("Cognito is not configured. Please set COGNITO_USER_POOL_ID environment variable.");
  }

  const createCommand = new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
      { Name: "name", Value: name },
    ],
    MessageAction: MessageActionType.SUPPRESS,
  });

  const createResponse = await client.send(createCommand);
  
  const setPasswordCommand = new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: email,
    Password: password,
    Permanent: true,
  });

  await client.send(setPasswordCommand);

  const userSub = createResponse.User?.Attributes?.find(attr => attr.Name === "sub")?.Value;
  if (!userSub) {
    throw new Error("Failed to get user sub from Cognito");
  }

  return userSub;
}

export async function updateCognitoUser(email: string, updates: { name?: string; newEmail?: string }): Promise<void> {
  if (!userPoolId) {
    throw new Error("Cognito is not configured. Please set COGNITO_USER_POOL_ID environment variable.");
  }

  const attributes: { Name: string; Value: string }[] = [];
  
  if (updates.name) {
    attributes.push({ Name: "name", Value: updates.name });
  }
  
  if (updates.newEmail) {
    attributes.push({ Name: "email", Value: updates.newEmail });
    attributes.push({ Name: "email_verified", Value: "true" });
  }

  if (attributes.length > 0) {
    const command = new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: attributes,
    });

    await client.send(command);
  }
}

export async function deleteCognitoUser(email: string): Promise<void> {
  if (!userPoolId) {
    throw new Error("Cognito is not configured. Please set COGNITO_USER_POOL_ID environment variable.");
  }

  const command = new AdminDeleteUserCommand({
    UserPoolId: userPoolId,
    Username: email,
  });

  await client.send(command);
}

export async function getCognitoUser(email: string): Promise<CognitoUser | null> {
  try {
    const command = new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: email,
    });

    const response = await client.send(command);
    
    const emailAttr = response.UserAttributes?.find(attr => attr.Name === "email")?.Value;
    const subAttr = response.UserAttributes?.find(attr => attr.Name === "sub")?.Value;

    if (!emailAttr || !subAttr) {
      return null;
    }

    return {
      username: response.Username!,
      email: emailAttr,
      sub: subAttr,
    };
  } catch (error) {
    return null;
  }
}

export async function setUserPassword(email: string, password: string): Promise<void> {
  if (!userPoolId) {
    throw new Error("Cognito is not configured. Please set COGNITO_USER_POOL_ID environment variable.");
  }

  const command = new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: email,
    Password: password,
    Permanent: true,
  });

  await client.send(command);
}
