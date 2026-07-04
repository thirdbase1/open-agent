import { STATUS_CODES } from 'node:http';
import { escape } from 'node:querystring';

import { HttpStatus, Logger } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';

export type UserFriendlyErrorBaseType =
  | 'network_error'
  | 'bad_request'
  | 'too_many_requests'
  | 'resource_not_found'
  | 'resource_already_exists'
  | 'invalid_input'
  | 'action_forbidden'
  | 'no_permission'
  | 'quota_exceeded'
  | 'authentication_required'
  | 'internal_server_error';

type ErrorArgType = 'string' | 'number' | 'boolean';
type ErrorArgs = Record<string, ErrorArgType>;

export type UserFriendlyErrorOptions = {
  type: UserFriendlyErrorBaseType;
  args?: ErrorArgs;
  message: string | ((args: any) => string);
};

const BaseTypeToHttpStatusMap: Record<UserFriendlyErrorBaseType, HttpStatus> = {
  network_error: HttpStatus.GATEWAY_TIMEOUT,
  too_many_requests: HttpStatus.TOO_MANY_REQUESTS,
  bad_request: HttpStatus.BAD_REQUEST,
  resource_not_found: HttpStatus.NOT_FOUND,
  resource_already_exists: HttpStatus.BAD_REQUEST,
  invalid_input: HttpStatus.BAD_REQUEST,
  action_forbidden: HttpStatus.FORBIDDEN,
  no_permission: HttpStatus.FORBIDDEN,
  quota_exceeded: HttpStatus.PAYMENT_REQUIRED,
  authentication_required: HttpStatus.UNAUTHORIZED,
  internal_server_error: HttpStatus.INTERNAL_SERVER_ERROR,
};

const IncludedEvents = new Set([
  // email
  'invalid_email',
  'email_token_not_found',
  'invalid_email_token',
  'email_already_used',
  'same_email_provided',
  // magic link
  'action_forbidden',
  'link_expired',
  'email_verification_required',
  // oauth
  'missing_oauth_query_parameter',
  'unknown_oauth_provider',
  'invalid_oauth_callback_state',
  'invalid_oauth_state',
  'oauth_state_expired',
  'oauth_account_already_connected',
]);

export class UserFriendlyError extends Error {
  /**
   * Standard HTTP status code
   */
  status: number;

  /**
   * Business error category, for example 'resource_already_exists' or 'quota_exceeded'
   */
  type: string;

  /**
   * Additional data that could be used for error handling or formatting
   */
  data: any;

  /**
   * Request id for tracing
   */
  requestId?: string;

  constructor(
    type: UserFriendlyErrorBaseType,
    name: keyof typeof USER_FRIENDLY_ERRORS,
    message?: string | ((args?: any) => string),
    args?: any
  ) {
    const defaultMsg = USER_FRIENDLY_ERRORS[name].message;
    // disallow message override for `internal_server_error`
    // to avoid leak internal information to user
    let msg =
      name === 'internal_server_error' ? defaultMsg : (message ?? defaultMsg);

    if (typeof msg === 'function') {
      msg = msg(args);
    }

    super(msg);
    this.status = BaseTypeToHttpStatusMap[type];
    this.type = type;
    this.name = name;
    this.data = args;
    this.requestId = ClsServiceManager.getClsService()?.getId();
  }

  static fromUserFriendlyErrorJSON(body: UserFriendlyError) {
    return new UserFriendlyError(
      body.type.toLowerCase() as UserFriendlyErrorBaseType,
      body.name.toLowerCase() as keyof typeof USER_FRIENDLY_ERRORS,
      body.message,
      body.data
    );
  }

  get stacktrace() {
    return this.name === 'internal_server_error'
      ? ((this.cause as Error)?.stack ?? this.stack)
      : this.stack;
  }

  toJSON() {
    return {
      status: this.status,
      code: STATUS_CODES[this.status] ?? 'BAD REQUEST',
      type: this.type.toUpperCase(),
      name: this.name.toUpperCase(),
      message: this.message,
      data: this.data,
      // only include requestId for server error
      requestId: this.status >= 500 ? this.requestId : undefined,
    };
  }

  toText() {
    const json = this.toJSON();
    return [
      `Status: ${json.status}`,
      `Type: ${json.type}`,
      `Name: ${json.name}`,
      `Message: ${json.message}`,
      `Data: ${JSON.stringify(json.data)}`,
      `RequestId: ${json.requestId}`,
    ].join('\n');
  }

  log(context: string, debugInfo?: object) {
    // ignore all user behavior error log
    if (
      this.type !== 'internal_server_error' &&
      !IncludedEvents.has(this.name)
    ) {
      return;
    }

    const logger = new Logger(context);
    const fn = this.status >= 500 ? logger.error : logger.log;

    let message = this.name;
    if (debugInfo) {
      message += ` (${JSON.stringify(debugInfo)})`;
    }
    fn.call(logger, message, this);
  }
}

/**
 *
 * @ObjectType()
 * export class XXXDataType {
 *   @Field()
 *   [name]: [type];
 * }
 */
function generateErrorArgs(name: string, args: ErrorArgs) {
  const typeName = `${name}DataType`;
  const lines = [`@ObjectType()`, `class ${typeName} {`];
  Object.entries(args).forEach(([arg, fieldArgs]) => {
    lines.push(`  @Field() ${arg}!: ${fieldArgs}`);
  });

  lines.push('}');

  return { name: typeName, def: lines.join('\n') };
}

export function generateUserFriendlyErrors() {
  const output = [
    '/* oxlint-disable */',
    '// AUTO GENERATED FILE',
    `import { createUnionType, Field, ObjectType, registerEnumType } from '@nestjs/graphql';`,
    '',
    `import { UserFriendlyError } from './def';`,
  ];

  const errorNames: string[] = [];
  const argTypes: string[] = [];

  for (const code in USER_FRIENDLY_ERRORS) {
    errorNames.push(code.toUpperCase());
    // @ts-expect-error allow
    const options: UserFriendlyErrorOptions = USER_FRIENDLY_ERRORS[code];
    const className = code
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    const args = options.args
      ? generateErrorArgs(className, options.args)
      : null;

    const classDef = `
export class ${className} extends UserFriendlyError {
  constructor(${args ? `args: ${args.name}, ` : ''}message?: string${args ? ` | ((args: ${args.name}) => string)` : ''}) {
    super('${options.type}', '${code}', message${args ? ', args' : ''});
  }
}`;

    if (args) {
      output.push(args.def);
      argTypes.push(args.name);
    }
    output.push(classDef);
  }

  output.push(`export enum ErrorNames {
  ${errorNames.join(',\n  ')}
}
registerEnumType(ErrorNames, {
  name: 'ErrorNames'
})

export const ErrorDataUnionType = createUnionType({
  name: 'ErrorDataUnion',
  types: () =>
    [${argTypes.join(', ')}] as const,
});
`);

  return output.join('\n');
}

// DEFINE ALL USER FRIENDLY ERRORS HERE
export const USER_FRIENDLY_ERRORS = {
  // Internal uncaught errors
  internal_server_error: {
    type: 'internal_server_error',
    message: 'An internal error occurred.',
  },
  network_error: {
    type: 'network_error',
    message: 'Network error.',
  },
  too_many_request: {
    type: 'too_many_requests',
    message: 'Too many requests.',
  },
  not_found: {
    type: 'resource_not_found',
    message: 'Resource not found.',
  },
  bad_request: {
    type: 'bad_request',
    message: 'Bad request.',
  },
  graphql_bad_request: {
    type: 'bad_request',
    args: { code: 'string', message: 'string' },
    message: ({ code, message }) =>
      `GraphQL bad request, code: ${code}, ${message}`,
  },
  http_request_error: {
    type: 'bad_request',
    args: { message: 'string' },
    message: ({ message }) => `HTTP request error, message: ${message}`,
  },
  email_service_not_configured: {
    type: 'internal_server_error',
    message: 'Email service is not configured.',
  },

  // Input errors
  query_too_long: {
    type: 'invalid_input',
    args: { max: 'number' },
    message: ({ max }) => `Query is too long, max length is ${max}.`,
  },

  validation_error: {
    type: 'invalid_input',
    args: { errors: 'string' },
    message: ({ errors }) => `Validation error, errors: ${errors}`,
  },

  // User Errors
  user_not_found: {
    type: 'resource_not_found',
    message: 'User not found.',
  },
  user_avatar_not_found: {
    type: 'resource_not_found',
    message: 'User avatar not found.',
  },
  email_already_used: {
    type: 'resource_already_exists',
    message: 'This email has already been registered.',
  },
  same_email_provided: {
    type: 'invalid_input',
    message:
      'You are trying to update your account email to the same as the old one.',
  },
  wrong_sign_in_credentials: {
    type: 'invalid_input',
    args: { email: 'string' },
    message: ({ email }) => `Wrong user email or password: ${email}`,
  },
  unknown_oauth_provider: {
    type: 'invalid_input',
    args: { name: 'string' },
    message: ({ name }) => `Unknown authentication provider ${name}.`,
  },
  oauth_state_expired: {
    type: 'bad_request',
    message: 'OAuth state expired, please try again.',
  },
  invalid_oauth_callback_state: {
    type: 'bad_request',
    message: 'Invalid callback state parameter.',
  },
  invalid_oauth_callback_code: {
    type: 'bad_request',
    args: { status: 'number', body: 'string' },
    message: ({ status, body }) =>
      `Invalid callback code parameter, provider response status: ${status} and body: ${body}.`,
  },
  invalid_auth_state: {
    type: 'bad_request',
    message:
      'Invalid auth state. You might start the auth progress from another device.',
  },
  missing_oauth_query_parameter: {
    type: 'bad_request',
    args: { name: 'string' },
    message: ({ name }) => `Missing query parameter \`${name}\`.`,
  },
  oauth_account_already_connected: {
    type: 'bad_request',
    message:
      'The third-party account has already been connected to another user.',
  },
  invalid_oauth_response: {
    type: 'bad_request',
    args: { reason: 'string' },
    message: ({ reason }) => `Invalid OAuth response: ${reason}.`,
  },
  invalid_email: {
    type: 'invalid_input',
    args: { email: 'string' },
    message: ({ email }) => `An invalid email provided: ${email}`,
  },
  invalid_password_length: {
    type: 'invalid_input',
    args: { min: 'number', max: 'number' },
    message: ({ min, max }) =>
      `Password must be between ${min} and ${max} characters`,
  },
  password_required: {
    type: 'invalid_input',
    message: 'Password is required.',
  },
  wrong_sign_in_method: {
    type: 'invalid_input',
    message:
      'You are trying to sign in by a different method than you signed up with.',
  },
  early_access_required: {
    type: 'action_forbidden',
    message: `You don't have early access permission.`,
  },
  sign_up_forbidden: {
    type: 'action_forbidden',
    message: `You are not allowed to sign up.`,
  },
  email_token_not_found: {
    type: 'invalid_input',
    message: 'The email token provided is not found.',
  },
  invalid_email_token: {
    type: 'invalid_input',
    message: 'An invalid email token provided.',
  },
  link_expired: {
    type: 'bad_request',
    message: 'The link has expired.',
  },

  // Authentication & Permission Errors
  authentication_required: {
    type: 'authentication_required',
    message: 'You must sign in first to access this resource.',
  },
  action_forbidden: {
    type: 'action_forbidden',
    message: 'You are not allowed to perform this action.',
  },
  access_denied: {
    type: 'no_permission',
    message: 'You do not have permission to access this resource.',
  },
  email_verification_required: {
    type: 'action_forbidden',
    message: 'You must verify your email before accessing this resource.',
  },

  // Copilot errors
  copilot_session_not_found: {
    type: 'resource_not_found',
    message: `Copilot session not found.`,
  },
  copilot_session_invalid_input: {
    type: 'invalid_input',
    message: `Copilot session input is invalid.`,
  },
  copilot_session_deleted: {
    type: 'action_forbidden',
    message: `Copilot session has been deleted.`,
  },
  no_copilot_provider_available: {
    type: 'internal_server_error',
    args: { modelId: 'string' },
    message: ({ modelId }) => `No copilot provider available: ${modelId}`,
  },
  copilot_failed_to_generate_text: {
    type: 'internal_server_error',
    message: `Failed to generate text.`,
  },
  copilot_failed_to_generate_embedding: {
    type: 'internal_server_error',
    args: { provider: 'string', message: 'string' },
    message: ({ provider, message }) =>
      `Failed to generate embedding with ${provider}: ${message}`,
  },
  copilot_failed_to_create_message: {
    type: 'internal_server_error',
    message: `Failed to create chat message.`,
  },
  unsplash_is_not_configured: {
    type: 'internal_server_error',
    message: `Image search is not configured.`,
  },
  copilot_action_taken: {
    type: 'action_forbidden',
    message: `Action has been taken, no more messages allowed.`,
  },
  copilot_doc_not_found: {
    type: 'resource_not_found',
    args: { docId: 'string' },
    message: ({ docId }) => `Doc ${docId} not found.`,
  },
  copilot_docs_not_found: {
    type: 'resource_not_found',
    message: () => `Some docs not found.`,
  },
  copilot_message_not_found: {
    type: 'resource_not_found',
    args: { messageId: 'string' },
    message: ({ messageId }) => `Copilot message ${messageId} not found.`,
  },
  copilot_prompt_not_found: {
    type: 'resource_not_found',
    args: { name: 'string' },
    message: ({ name }) => `Copilot prompt ${name} not found.`,
  },
  copilot_prompt_invalid: {
    type: 'invalid_input',
    message: `Copilot prompt is invalid.`,
  },
  copilot_provider_not_supported: {
    type: 'invalid_input',
    args: { provider: 'string', kind: 'string' },
    message: ({ provider, kind }) =>
      `Copilot provider ${provider} does not support output type ${kind}`,
  },
  copilot_provider_side_error: {
    type: 'internal_server_error',
    args: { provider: 'string', kind: 'string', message: 'string' },
    message: ({ provider, kind, message }) =>
      `Provider ${provider} failed with ${kind} error: ${message || 'unknown'}`,
  },
  copilot_invalid_context: {
    type: 'invalid_input',
    args: { contextId: 'string' },
    message: ({ contextId }) => `Invalid copilot context ${contextId}.`,
  },
  copilot_context_file_not_supported: {
    type: 'bad_request',
    args: { fileName: 'string', message: 'string' },
    message: ({ fileName, message }) =>
      `File ${fileName} is not supported to use as context: ${message}`,
  },
  copilot_failed_to_modify_context: {
    type: 'internal_server_error',
    args: { contextId: 'string', message: 'string' },
    message: ({ contextId, message }) =>
      `Failed to modify context ${contextId}: ${message}`,
  },
  copilot_failed_to_match_context: {
    type: 'internal_server_error',
    args: { contextId: 'string', content: 'string', message: 'string' },
    message: ({ contextId, content, message }) =>
      `Failed to match context ${contextId} with "${escape(content)}": ${message}`,
  },
  copilot_failed_to_match_global_context: {
    type: 'internal_server_error',
    args: { userId: 'string', content: 'string', message: 'string' },
    message: ({ userId, content, message }) =>
      `Failed to match context for user ${userId} with "${escape(content)}": ${message}`,
  },
  copilot_embedding_unavailable: {
    type: 'action_forbidden',
    message: `Embedding feature not available, you may need to install pgvector extension to your database`,
  },
  copilot_transcription_job_exists: {
    type: 'bad_request',
    message: 'Transcription job already exists',
  },
  copilot_transcription_job_not_found: {
    type: 'bad_request',
    message: `Transcription job not found.`,
  },
  copilot_transcription_audio_not_provided: {
    type: 'bad_request',
    message: `Audio not provided.`,
  },
  copilot_failed_to_add_user_artifact: {
    type: 'internal_server_error',
    args: { message: 'string', type: 'string' },
    message: ({ message, type }) =>
      `Failed to add user ${type}, error: ${message}`,
  },

  // Quota & Limit errors
  blob_not_found: {
    type: 'resource_not_found',
    args: { userId: 'string', blobId: 'string' },
    message: ({ userId, blobId }) =>
      `Blob ${blobId} not found for user ${userId}.`,
  },
  blob_quota_exceeded: {
    type: 'quota_exceeded',
    message: 'You have exceeded your blob size quota.',
  },
  storage_quota_exceeded: {
    type: 'quota_exceeded',
    message: 'You have exceeded your storage quota.',
  },
  copilot_quota_exceeded: {
    type: 'quota_exceeded',
    message: 'You have reached the limit of actions, please upgrade your plan.',
  },

  // Config errors
  runtime_config_not_found: {
    type: 'resource_not_found',
    args: { key: 'string' },
    message: ({ key }) => `Runtime config ${key} not found.`,
  },
  invalid_runtime_config_type: {
    type: 'invalid_input',
    args: { key: 'string', want: 'string', get: 'string' },
    message: ({ key, want, get }) =>
      `Invalid runtime config type  for '${key}', want '${want}', but get ${get}.`,
  },
  mailer_service_is_not_configured: {
    type: 'internal_server_error',
    message: 'Mailer service is not configured.',
  },
  cannot_delete_all_admin_account: {
    type: 'action_forbidden',
    message: 'Cannot delete all admin accounts.',
  },

  // Account errors
  cannot_delete_own_account: {
    type: 'action_forbidden',
    message: 'Cannot delete own account.',
  },

  // captcha errors
  captcha_verification_failed: {
    type: 'bad_request',
    message: 'Captcha verification failed.',
  },

  // version errors
  unsupported_client_version: {
    type: 'action_forbidden',
    args: {
      clientVersion: 'string',
      requiredVersion: 'string',
    },
    message: ({ clientVersion, requiredVersion }) =>
      `Unsupported client with version [${clientVersion}], required version is [${requiredVersion}].`,
  },

  // app config
  invalid_app_config: {
    type: 'invalid_input',
    args: { module: 'string', key: 'string', hint: 'string' },
    message: ({ module, key, hint }) =>
      `Invalid app config for module \`${module}\` with key \`${key}\`. ${hint}.`,
  },
  invalid_app_config_input: {
    type: 'invalid_input',
    args: { message: 'string' },
    message: ({ message }) => `Invalid app config input: ${message}`,
  },
} satisfies Record<string, UserFriendlyErrorOptions>;
