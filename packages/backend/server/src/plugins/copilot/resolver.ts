import { createHash } from 'node:crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Args,
  Field,
  Float,
  ID,
  InputType,
  Mutation,
  ObjectType,
  Parent,
  Query,
  registerEnumType,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AiPromptRole } from '@prisma/client';
import { GraphQLJSON, SafeIntResolver } from 'graphql-scalars';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';

import {
  CallMetric,
  CopilotFailedToCreateMessage,
  CopilotSessionNotFound,
  type FileUpload,
  paginate,
  Paginated,
  PaginationInput,
  RequestMutex,
  Throttle,
  TooManyRequest,
} from '../../base';
import { CurrentUser } from '../../core/auth';
import { Admin } from '../../core/common';
import { UserType } from '../../core/user';
import type { ListSessionOptions, UpdateChatSession } from '../../models';
import { CopilotCronJobs } from './cron';
import { PromptService } from './prompt';
import { PromptMessage, StreamObject } from './providers/types';
import { CopilotProviderFactory } from './providers/factory';
import { ChatSessionService } from './session';
import { CopilotStorage } from './storage';
import { type ChatHistory, type ChatMessage, SubmittedMessage } from './types';

export const COPILOT_LOCKER = 'copilot';

// ================== Input Types ==================

@InputType()
class CreateChatSessionInput {
  @Field(() => String, {
    description: 'The prompt name to use for the session',
  })
  promptName!: string;

  @Field(() => String, {
    description: 'mark the session create from which doc',
    nullable: true,
  })
  docId?: string;

  @Field(() => Boolean, { nullable: true })
  pinned?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description: 'true by default, compliant for old version',
  })
  reuseLatestChat?: boolean;
}

@InputType()
class UpdateChatSessionInput
  implements Omit<UpdateChatSession, 'userId' | 'title'>
{
  @Field(() => String)
  sessionId!: string;

  @Field(() => Boolean, {
    description: 'Whether to pin the session',
    nullable: true,
  })
  pinned!: boolean | undefined;

  @Field(() => String, {
    description: 'The prompt name to use for the session',
    nullable: true,
  })
  promptName!: string;

  @Field(() => String, {
    description: 'Client custom metadata for the session',
    nullable: true,
  })
  metadata!: string;
}

@InputType()
class RemoveSessionInput {
  @Field(() => String)
  sessionId!: string;
}

@InputType()
class CreateChatMessageInput implements Omit<SubmittedMessage, 'content'> {
  @Field(() => String)
  sessionId!: string;

  @Field(() => String, { nullable: true })
  content!: string | undefined;

  @Field(() => GraphQLUpload, { nullable: true })
  blob!: Promise<FileUpload> | undefined;

  @Field(() => [GraphQLUpload], { nullable: true })
  blobs!: Promise<FileUpload>[] | undefined;

  @Field(() => GraphQLJSON, { nullable: true })
  params!: Record<string, any> | undefined;
}

enum ChatHistoryOrder {
  asc = 'asc',
  desc = 'desc',
}

registerEnumType(ChatHistoryOrder, { name: 'ChatHistoryOrder' });

@InputType()
class QueryChatSessionsInput implements Partial<ListSessionOptions> {
  @Field(() => Boolean, { nullable: true })
  action: boolean | undefined;

  @Field(() => Boolean, { nullable: true })
  pinned: boolean | undefined;

  @Field(() => Number, { nullable: true })
  limit: number | undefined;

  @Field(() => Number, { nullable: true })
  skip: number | undefined;
}

@InputType()
class QueryChatHistoriesInput
  extends QueryChatSessionsInput
  implements Partial<ListSessionOptions>
{
  @Field(() => ChatHistoryOrder, { nullable: true })
  messageOrder: 'asc' | 'desc' | undefined;

  @Field(() => ChatHistoryOrder, { nullable: true })
  sessionOrder: 'asc' | 'desc' | undefined;

  @Field(() => String, { nullable: true })
  sessionId: string | undefined;

  @Field(() => Boolean, { nullable: true })
  withMessages: boolean | undefined;

  @Field(() => Boolean, { nullable: true })
  withPrompt: boolean | undefined;
}

// ================== Return Types ==================

@ObjectType('StreamObject')
class StreamObjectType {
  @Field(() => String)
  type!: string;

  @Field(() => String, { nullable: true })
  textDelta?: string;

  @Field(() => String, { nullable: true })
  toolCallId?: string;

  @Field(() => String, { nullable: true })
  toolName?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  args?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  result?: any;
}

@ObjectType('ChatMessage')
class ChatMessageType implements Partial<ChatMessage> {
  // id will be null if message is a prompt message
  @Field(() => ID, { nullable: true })
  id!: string | undefined;

  @Field(() => String)
  role!: 'system' | 'assistant' | 'user';

  @Field(() => String)
  content!: string;

  @Field(() => [StreamObjectType], { nullable: true })
  streamObjects!: StreamObject[];

  @Field(() => [String], { nullable: true })
  attachments!: string[];

  @Field(() => GraphQLJSON, { nullable: true })
  params!: Record<string, string> | undefined;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('CopilotHistories')
class CopilotHistoriesType implements Omit<ChatHistory, 'userId'> {
  @Field(() => String)
  sessionId!: string;

  @Field(() => String)
  promptName!: string;

  @Field(() => String)
  model!: string;

  @Field(() => [String])
  optionalModels!: string[];

  @Field(() => String, {
    description: 'An mark identifying which view to use to display the session',
    nullable: true,
  })
  action!: string | null;

  @Field(() => Boolean)
  pinned!: boolean;

  @Field(() => String, { nullable: true })
  title!: string | null;

  @Field(() => String)
  metadata!: string;

  @Field(() => Number, {
    description: 'The number of tokens used in the session',
  })
  tokens!: number;

  @Field(() => [ChatMessageType])
  messages!: ChatMessageType[];

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType()
export class PaginatedCopilotHistoriesType extends Paginated(
  CopilotHistoriesType
) {}

@ObjectType('CopilotQuota')
class CopilotQuotaType {
  @Field(() => SafeIntResolver, { nullable: true })
  limit?: number;

  @Field(() => SafeIntResolver)
  used!: number;
}

registerEnumType(AiPromptRole, {
  name: 'CopilotPromptMessageRole',
});

@InputType('CopilotPromptConfigInput')
@ObjectType()
class CopilotPromptConfigType {
  @Field(() => Float, { nullable: true })
  frequencyPenalty!: number | null;

  @Field(() => Float, { nullable: true })
  presencePenalty!: number | null;

  @Field(() => Float, { nullable: true })
  temperature!: number | null;

  @Field(() => Float, { nullable: true })
  topP!: number | null;
}

@InputType('CopilotPromptMessageInput')
@ObjectType()
class CopilotPromptMessageType {
  @Field(() => AiPromptRole)
  role!: AiPromptRole;

  @Field(() => String)
  content!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  params!: Record<string, string> | null;
}

@ObjectType()
class CopilotPromptType {
  @Field(() => String)
  name!: string;

  @Field(() => String)
  model!: string;

  @Field(() => String, { nullable: true })
  action!: string | null;

  @Field(() => CopilotPromptConfigType, { nullable: true })
  config!: CopilotPromptConfigType | null;

  @Field(() => [CopilotPromptMessageType])
  messages!: CopilotPromptMessageType[];
}

@ObjectType()
export class CopilotSessionType {
  @Field(() => ID)
  id!: string;

  @Field(() => Boolean)
  pinned!: boolean;

  @Field(() => String, { nullable: true })
  title!: string | null;

  @Field(() => String)
  promptName!: string;

  @Field(() => String)
  model!: string;

  @Field(() => [String])
  optionalModels!: string[];
}

// ================== Resolver ==================

@ObjectType('Copilot')
export class CopilotType {
  @Field(() => String)
  userId!: string;
}


@ObjectType('CopilotModelInfo')
class CopilotModelInfoType {
  @Field(() => String)
  provider!: string;

  @Field(() => String)
  modelId!: string;

  @Field(() => [String])
  inputTypes!: string[];

  @Field(() => [String])
  outputTypes!: string[];
}

@Throttle()
@Resolver(() => CopilotType)
export class CopilotResolver {
  constructor(
    private readonly mutex: RequestMutex,
    private readonly chatSession: ChatSessionService,
    private readonly storage: CopilotStorage,
    private readonly providerFactory: CopilotProviderFactory
  ) {}

  @Query(() => [CopilotModelInfoType], {
    description: 'List all available models from configured providers',
  })
  @CallMetric('ai', 'list_models')
  async listCopilotModels(): Promise<CopilotModelInfoType[]> {
    return this.providerFactory.listAllModels().map(m => ({
      provider: m.provider,
      modelId: m.modelId,
      inputTypes: m.capabilities.flatMap(c => c.input),
      outputTypes: m.capabilities.flatMap(c => c.output),
    }));
  }

  @ResolveField(() => CopilotQuotaType, {
    name: 'quota',
    description: 'Get the quota of the user',
    complexity: 2,
  })
  async getQuota(@CurrentUser() user: CurrentUser): Promise<CopilotQuotaType> {
    return await this.chatSession.getQuota(user.id);
  }

  @ResolveField(() => CopilotSessionType, {
    description: 'Get the session by id',
    complexity: 2,
  })
  async session(
    @Args('sessionId') sessionId: string
  ): Promise<CopilotSessionType> {
    const session = await this.chatSession.getSessionInfo(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return this.transformToSessionType(session);
  }

  @ResolveField(() => PaginatedCopilotHistoriesType, {})
  @CallMetric('ai', 'histories')
  async chats(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUser,
    @Args('pagination', PaginationInput.decode) pagination: PaginationInput,
    @Args('options', { nullable: true }) options?: QueryChatHistoriesInput
  ): Promise<PaginatedCopilotHistoriesType> {
    const finalOptions = Object.assign(
      {},
      options,
      { userId: user.id },
      { skip: pagination.offset, limit: pagination.first }
    );
    const totalCount = await this.chatSession.count(finalOptions);
    const histories = await this.chatSession.list(
      finalOptions,
      !!options?.withMessages
    );

    return paginate(
      histories.map(h => ({
        ...h,
        // filter out empty messages
        messages: h.messages?.filter(
          m => m.content || m.attachments?.length
        ) as ChatMessageType[],
      })),
      'updatedAt',
      pagination,
      totalCount
    );
  }

  @Mutation(() => String, {
    description: 'Create a chat session',
  })
  @CallMetric('ai', 'chat_session_create')
  async createCopilotSession(
    @CurrentUser() user: CurrentUser,
    @Args({ name: 'options', type: () => CreateChatSessionInput })
    options: CreateChatSessionInput
  ): Promise<string> {
    const lockFlag = `${COPILOT_LOCKER}:session:${user.id}`;
    await using lock = await this.mutex.acquire(lockFlag);
    if (!lock) {
      throw new TooManyRequest('Server is busy');
    }

    await this.chatSession.checkQuota(user.id);

    return await this.chatSession.create({
      ...options,
      pinned: options.pinned ?? false,
      userId: user.id,
    });
  }

  @Mutation(() => String, {
    description: 'Update a chat session',
  })
  @CallMetric('ai', 'chat_session_update')
  async updateCopilotSession(
    @CurrentUser() user: CurrentUser,
    @Args({ name: 'options', type: () => UpdateChatSessionInput })
    options: UpdateChatSessionInput
  ): Promise<string> {
    const session = await this.chatSession.get(options.sessionId);
    if (!session || session.config.userId !== user.id) {
      throw new CopilotSessionNotFound();
    }

    const lockFlag = `${COPILOT_LOCKER}:session:${user.id}`;
    await using lock = await this.mutex.acquire(lockFlag);
    if (!lock) {
      throw new TooManyRequest('Server is busy');
    }

    await this.chatSession.checkQuota(user.id);
    return await this.chatSession.update({
      ...options,
      userId: user.id,
    });
  }

  @Mutation(() => [String], {
    description: 'Cleanup sessions',
  })
  @CallMetric('ai', 'chat_session_cleanup')
  async removeCopilotSession(
    @CurrentUser() user: CurrentUser,
    @Args({ name: 'options', type: () => RemoveSessionInput })
    options: RemoveSessionInput
  ): Promise<string[]> {
    const lockFlag = `${COPILOT_LOCKER}:session:${user.id}:${options.sessionId}`;
    await using lock = await this.mutex.acquire(lockFlag);
    if (!lock) {
      throw new TooManyRequest('Server is busy');
    }

    return await this.chatSession.cleanup({
      sessionIds: [options.sessionId],
      userId: user.id,
    });
  }

  @Mutation(() => String, {
    description: 'Create a chat message',
  })
  @CallMetric('ai', 'chat_message_create')
  async createCopilotMessage(
    @CurrentUser() user: CurrentUser,
    @Args({ name: 'options', type: () => CreateChatMessageInput })
    options: CreateChatMessageInput
  ): Promise<string> {
    const lockFlag = `${COPILOT_LOCKER}:message:${user?.id}:${options.sessionId}`;
    await using lock = await this.mutex.acquire(lockFlag);
    if (!lock) {
      throw new TooManyRequest('Server is busy');
    }
    const session = await this.chatSession.get(options.sessionId);
    if (!session || session.config.userId !== user.id) {
      throw new BadRequestException('Session not found');
    }

    const attachments: PromptMessage['attachments'] = [];
    if (options.blob || options.blobs) {
      const blobs = await Promise.all(
        options.blob ? [options.blob] : options.blobs || []
      );
      delete options.blob;
      delete options.blobs;

      for (const blob of blobs) {
        const uploaded = await this.storage.handleUpload(user.id, blob);
        const filename = createHash('sha256')
          .update(uploaded.buffer)
          .digest('base64url');
        const attachment = await this.storage.put(
          user.id,
          filename,
          uploaded.buffer
        );
        attachments.push({ attachment, mimeType: blob.mimetype });
      }
    }

    try {
      return await this.chatSession.createMessage({ ...options, attachments });
    } catch (e: any) {
      throw new CopilotFailedToCreateMessage(e.message);
    }
  }

  private transformToSessionType(
    session: Omit<ChatHistory, 'messages'>
  ): CopilotSessionType {
    return { id: session.sessionId, ...session };
  }
}

@Throttle()
@Resolver(() => UserType)
export class UserCopilotResolver {
  @ResolveField(() => CopilotType)
  async copilot(@CurrentUser() user: CurrentUser): Promise<CopilotType> {
    return { userId: user.id };
  }
}

@InputType()
class CreateCopilotPromptInput {
  @Field(() => String)
  name!: string;

  @Field(() => String)
  model!: string;

  @Field(() => String, { nullable: true })
  action!: string | null;

  @Field(() => CopilotPromptConfigType, { nullable: true })
  config!: CopilotPromptConfigType | null;

  @Field(() => [CopilotPromptMessageType])
  messages!: CopilotPromptMessageType[];
}

@Admin()
@Resolver(() => String)
export class PromptsManagementResolver {
  constructor(
    private readonly cron: CopilotCronJobs,
    private readonly promptService: PromptService
  ) {}

  @Mutation(() => Boolean, {
    description: 'Trigger generate missing titles cron job',
  })
  async triggerGenerateTitleCron() {
    await this.cron.triggerGenerateMissingTitles();
    return true;
  }

  @Query(() => [CopilotPromptType], {
    description: 'List all copilot prompts',
  })
  async listCopilotPrompts() {
    const prompts = await this.promptService.list();
    return prompts.filter(
      p =>
        p.messages.length > 0 &&
        // ignore internal prompts
        !p.name.startsWith('workflow:') &&
        !p.name.startsWith('debug:') &&
        !p.name.startsWith('chat:') &&
        !p.name.startsWith('action:')
    );
  }

  @Mutation(() => CopilotPromptType, {
    description: 'Create a copilot prompt',
  })
  async createCopilotPrompt(
    @Args({ type: () => CreateCopilotPromptInput, name: 'input' })
    input: CreateCopilotPromptInput
  ) {
    await this.promptService.set(
      input.name,
      input.model,
      input.messages,
      input.config
    );
    return this.promptService.get(input.name);
  }

  @Mutation(() => CopilotPromptType, {
    description: 'Update a copilot prompt',
  })
  async updateCopilotPrompt(
    @Args('name') name: string,
    @Args('messages', { type: () => [CopilotPromptMessageType] })
    messages: CopilotPromptMessageType[]
  ) {
    await this.promptService.update(name, { messages, modified: true });
    return this.promptService.get(name);
  }
}
