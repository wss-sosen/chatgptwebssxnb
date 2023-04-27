import { create } from "zustand"; // 从zustand库中引入create函数
import { persist } from "zustand/middleware"; // 从zustand库中引入persist中间件

import { type ChatCompletionResponseMessage } from "openai"; // 从openai库中引入ChatCompletionResponseMessage类型
import {
  ControllerPool,
  requestChatStream,
  requestWithPrompt,
} from "../requests"; // 从../requests中引入ControllerPool、requestChatStream和requestWithPrompt
import { isMobileScreen, trimTopic } from "../utils"; // 从../utils中引入isMobileScreen和trimTopic函数

import Locale from "../locales"; // 从../locales中引入Locale对象
import { showToast } from "../components/ui-lib"; // 从../components/ui-lib中引入showToast函数

export type Message = ChatCompletionResponseMessage & { // 定义Message类型为ChatCompletionResponseMessage类型，并添加date、streaming、isError和id属性。这里使用合并类型。
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id?: number;
};

export function createMessage(override: Partial<Message>): Message { // 定义createMessage函数，用于创建Message对象，可以覆盖默认值。返回Message对象。
  return {
    id: Date.now(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override, // ES6的展开运算符，可以将传入的覆盖属性直接赋值给Message对象。
  };
}

export enum SubmitKey { // 定义枚举类型SubmitKey，包括Enter、CtrlEnter、ShiftEnter、AltEnter和MetaEnter。每个枚举值都对应一个字符串类型的键盘事件。
  Enter = "Enter",
  CtrlEnter = "Ctrl + Enter",
  ShiftEnter = "Shift + Enter",
  AltEnter = "Alt + Enter",
  MetaEnter = "Meta + Enter",
}

export enum Theme { // 定义枚举类型Theme，包括Auto、Dark和Light，表示颜色主题。
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

export interface ChatConfig { // 定义接口类型ChatConfig，包括一些聊天相关的配置参数。
  historyMessageCount: number; // 显示的历史聊天消息数量，-1表示显示全部。
  compressMessageLengthThreshold: number; // 如果消息长度超过此值，则显示省略号。
  sendBotMessages: boolean; // 是否显示机器人的消息。
  submitKey: SubmitKey; // 提交聊天消息的键盘事件。
  avatar: string; // 聊天对话框中显示的头像。
  fontSize: number; // 字体大小。
  theme: Theme; // 主题颜色。
  tightBorder: boolean; // 是否显示聊天框的边框。
  sendPreviewBubble: boolean; // 是否显示聊天消息的预览气泡。
  sidebarWidth: number; // 侧边栏的宽度。

  disablePromptHint: boolean; // 是否禁用自动提示。

  modelConfig: { // 选择的模型相关配置。
    model: string; // 模型名称。
    temperature: number; // 控制生成器在生成时添加的随机性，值越大，生成结果越随机。
    max_tokens: number; // 生成器生成的token数量，数值越大，生成的结果就越长。
    presence_penalty: number; // 控制生成器在生成时添加的“提供引导信息”的强度。
  };
}

export type ModelConfig = ChatConfig["modelConfig"]; // 定义ModelConfig类型，为ChatConfig中modelConfig的类型。

export const ROLES: Message["role"][] = ["system", "user", "assistant"]; // 定义ROLES常量，包括system、user和assistant，表示聊天框中的角色。

const ENABLE_GPT4 = true; // 定义ENABLE_GPT4常量，表示是否启用GPT-4模型。

export const ALL_MODELS = [ // 定义ALL_MODELS常量，包含多个模型的名称和是否可用的状态。
  {
    name: "（禁用）gpt-4",
    available: ENABLE_GPT4,
  },
  {
    name: "（禁用）gpt-4-0314",
    available: ENABLE_GPT4,
  },
  {
    name: "（禁用）gpt-4-32k",
    available: ENABLE_GPT4,
  },
  {
    name: "（禁用）gpt-4-32k-0314",
    available: ENABLE_GPT4,
  },
  {
    name: "gpt-3.5-turbo",
    available: true,
  },
  {
    name: "gpt-3.5-turbo-0301",
    available: true,
  },
];

export function limitNumber( // 定义limitNumber函数，用于限制数字的取值范围。
  x: number, // 需要限制范围的数字。
  min: number, // 最小值。
  max: number, // 最大值。
  defaultValue: number, // 默认值，如果x不是数字类型或为NaN时，则返回defaultValue。
) {
  if (typeof x !== "number" || isNaN(x)) { // 如果x不是数字类型或为NaN，则返回默认值。
    return defaultValue;
  }

  return Math.min(max, Math.max(min, x)); // 如果x在[min, max]范围内，则返回x，否则返回[min, max]范围内最接近x的数字。
}

export function limitModel(name: string) { // 定义limitModel函数，用于限制模型的名称。
  return ALL_MODELS.some((m) => m.name === name && m.available) // 如果ALL_MODELS中存在name相同且available为true的模型，则返回name，否则返回ALL_MODELS[4].name。
    ? name
    : ALL_MODELS[4].name;
}

export const ModalConfigValidator = { // 定义ModalConfigValidator对象，包含多个属性（函数），用于验证和限制modelConfig中的各项参数。
  model(x: string) { // 验证model参数。
    return limitModel(x);
  },
  max_tokens(x: number) { // 验证max_tokens参数。
    return limitNumber(x, 0, 32000, 2000);
  },
  presence_penalty(x: number) { // 验证presence_penalty参数。
    return limitNumber(x, -2, 2, 0);
  },
  temperature(x: number) { // 验证temperature参数。
    return limitNumber(x, 0, 2, 1);
  },
};

const DEFAULT_CONFIG: ChatConfig = { // 定义DEFAULT_CONFIG常量，表示聊天框的默认配置。
  historyMessageCount: 4, // 默认显示4条历史聊天记录。
  compressMessageLengthThreshold: 1000, // 如果消息长度超过1000，则显示省略号。
  sendBotMessages: true as boolean, // 默认发送机器人的消息。
  submitKey: SubmitKey.Enter as SubmitKey, // 默认使用Enter键提交聊天消息。
  avatar: "1f603", // 默认头像
  fontSize: 14, // 默认字体大小为14。
  theme: Theme.Light as Theme, // 默认主题颜色为浅色。
  tightBorder: false, // 默认不显示边框。
  sendPreviewBubble: true, // 默认显示聊天消息的预览气泡。
  sidebarWidth: 300, // 默认侧栏宽度为300。

  disablePromptHint: false, // 默认开启自动提示。

  modelConfig: {
    model: "gpt-3.5-turbo", // 默认选择gpt-3.5-turbo模型。
    temperature: 1, // 默认随机性值为1。
    max_tokens: 2000, // 默认生成消息的token数量为2000。
    presence_penalty: 0, // 默认“提供引导信息”的强度为0。
  },
};

export interface ChatStat { // 定义ChatStat接口，包括tokenCount、wordCount和charCount属性，表示聊天消息的信息统计。
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession { // 定义ChatSession接口，表示聊天对话过程。
  id: number; // 会话ID。
  topic: string; // 会话主题。
  sendMemory: boolean; // 是否在生成器中使用上下文记忆。
  memoryPrompt: string; // 记忆提供的提示信息。
  context: Message[]; // 上下文信息，即历史聊天记录。
  messages: Message[]; // 消息记录。
  stat: ChatStat; // 消息统计信息，包括tokenCount、wordCount和charCount属性。
  lastUpdate: string; // 最后更新时间。
  lastSummarizeIndex: number; // 最后截取的摘要信息所处的消息记录索引。
}

const DEFAULT_TOPIC = Locale.Store.DefaultTopic; // 定义DEFAULT_TOPIC常量，表示默认的聊天主题。
export const BOT_HELLO: Message = createMessage({ // 定义BOT_HELLO常量，表示机器人的欢迎消息。
  role: "assistant",
  content: Locale.Store.BotHello, // 消息内容在Locales.Store.BotHello中定义。
});

function createEmptySession(): ChatSession { // 定义createEmptySession函数，用于创建一个空的ChatSession对象。
  const createDate = new Date().toLocaleString(); 

  return {
    id: Date.now(),
    topic: DEFAULT_TOPIC,
    sendMemory: true,
    memoryPrompt: "",
    context: [],
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: createDate,
    lastSummarizeIndex: 0,
  };
}


interface ChatStore {
  config: ChatConfig;
  sessions: ChatSession[];
  currentSessionIndex: number;
  clearSessions: () => void;
  removeSession: (index: number) => void;
  moveSession: (from: number, to: number) => void;
  selectSession: (index: number) => void;
  newSession: () => void;
  deleteSession: (index?: number) => void;
  currentSession: () => ChatSession;
  onNewMessage: (message: Message) => void;
  onUserInput: (content: string) => Promise<void>;
  summarizeSession: () => void;
  updateStat: (message: Message) => void;
  updateCurrentSession: (updater: (session: ChatSession) => void) => void;
  updateMessage: (
    sessionIndex: number,
    messageIndex: number,
    updater: (message?: Message) => void,
  ) => void;
  resetSession: () => void;
  getMessagesWithMemory: () => Message[];
  getMemoryPrompt: () => Message;

  getConfig: () => ChatConfig;
  resetConfig: () => void;
  updateConfig: (updater: (config: ChatConfig) => void) => void;
  clearAllData: () => void;
}

function countMessages(msgs: Message[]) {
  return msgs.reduce((pre, cur) => pre + cur.content.length, 0);
}

const LOCAL_KEY = "chat-next-web-store";

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [createEmptySession()],
      currentSessionIndex: 0,
      config: {
        ...DEFAULT_CONFIG,
      },

      clearSessions() {
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      resetConfig() {
        set(() => ({ config: { ...DEFAULT_CONFIG } }));
      },

      getConfig() {
        return get().config;
      },

      updateConfig(updater) {
        const config = get().config;
        updater(config);
        set(() => ({ config }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      removeSession(index: number) {
        set((state) => {
          let nextIndex = state.currentSessionIndex;
          const sessions = state.sessions;

          if (sessions.length === 1) {
            return {
              currentSessionIndex: 0,
              sessions: [createEmptySession()],
            };
          }

          sessions.splice(index, 1);

          if (nextIndex === index) {
            nextIndex -= 1;
          }

          return {
            currentSessionIndex: nextIndex,
            sessions,
          };
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession() {
        set((state) => ({
          currentSessionIndex: 0,
          sessions: [createEmptySession()].concat(state.sessions),
        }));
      },

      deleteSession(i?: number) {
        const deletedSession = get().currentSession();
        const index = i ?? get().currentSessionIndex;
        const isLastSession = get().sessions.length === 1;
        if (!isMobileScreen() || confirm(Locale.Home.DeleteChat)) {
          get().removeSession(index);

          showToast(
            Locale.Home.DeleteToast,
            {
              text: Locale.Home.Revert,
              onClick() {
                set((state) => ({
                  sessions: state.sessions
                    .slice(0, index)
                    .concat([deletedSession])
                    .concat(
                      state.sessions.slice(index + Number(isLastSession)),
                    ),
                }));
              },
            },
            5000,
          );
        }
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message) {
        get().updateCurrentSession((session) => {
          session.lastUpdate = new Date().toLocaleString();
        });
        get().updateStat(message);
        get().summarizeSession();
      },

      async onUserInput(content) {
        const userMessage: Message = createMessage({
          role: "user",
          content,
        });

        const botMessage: Message = createMessage({
          role: "assistant",
          streaming: true,
          id: userMessage.id! + 1,
        });

        // get recent messages
        const recentMessages = get().getMessagesWithMemory();
        const sendMessages = recentMessages.concat(userMessage);
        const sessionIndex = get().currentSessionIndex;
        const messageIndex = get().currentSession().messages.length + 1;

        // save user's and bot's message
        get().updateCurrentSession((session) => {
          session.messages.push(userMessage);
          session.messages.push(botMessage);
        });

        // make request
        console.log("[User Input] ", sendMessages);
        requestChatStream(sendMessages, {
          onMessage(content, done) {
            // stream response
            if (done) {
              botMessage.streaming = false;
              botMessage.content = content;
              get().onNewMessage(botMessage);
              ControllerPool.remove(
                sessionIndex,
                botMessage.id ?? messageIndex,
              );
            } else {
              botMessage.content = content;
              set(() => ({}));
            }
          },
          onError(error, statusCode) {
            if (statusCode === 401) {
              botMessage.content = Locale.Error.Unauthorized;
            } else if (!error.message.includes("aborted")) {
              botMessage.content += "\n\n" + Locale.Store.Error;
            }
            botMessage.streaming = false;
            userMessage.isError = true;
            botMessage.isError = true;
            set(() => ({}));
            ControllerPool.remove(sessionIndex, botMessage.id ?? messageIndex);
          },
          onController(controller) {
            // collect controller for stop/retry
            ControllerPool.addController(
              sessionIndex,
              botMessage.id ?? messageIndex,
              controller,
            );
          },
          filterBot: !get().config.sendBotMessages,
          modelConfig: get().config.modelConfig,
        });
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        return {
          role: "system",
          content: Locale.Store.Prompt.History(session.memoryPrompt),
          date: "",
        } as Message;
      },

      getMessagesWithMemory() {
        const session = get().currentSession();
        const config = get().config;
        const messages = session.messages.filter((msg) => !msg.isError);
        const n = messages.length;

        const context = session.context.slice();

        if (
          session.sendMemory &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0
        ) {
          const memoryPrompt = get().getMemoryPrompt();
          context.push(memoryPrompt);
        }

        const recentMessages = context.concat(
          messages.slice(Math.max(0, n - config.historyMessageCount)),
        );

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: Message) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession() {
        get().updateCurrentSession((session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      summarizeSession() {
        const session = get().currentSession();

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          session.topic === DEFAULT_TOPIC &&
          countMessages(session.messages) >= SUMMARIZE_MIN_LEN
        ) {
          requestWithPrompt(session.messages, Locale.Store.Prompt.Topic).then(
            (res) => {
              get().updateCurrentSession(
                (session) =>
                  (session.topic = res ? trimTopic(res) : DEFAULT_TOPIC),
              );
            },
          );
        }

        const config = get().config;
        let toBeSummarizedMsgs = session.messages.slice(
          session.lastSummarizeIndex,
        );

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (historyMsgLength > get().config?.modelConfig?.max_tokens ?? 4000) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            Math.max(0, n - config.historyMessageCount),
          );
        }

        // add memory prompt
        toBeSummarizedMsgs.unshift(get().getMemoryPrompt());

        const lastSummarizeIndex = session.messages.length;

        console.log(
          "[Chat History] ",
          toBeSummarizedMsgs,
          historyMsgLength,
          config.compressMessageLengthThreshold,
        );

        if (historyMsgLength > config.compressMessageLengthThreshold) {
          requestChatStream(
            toBeSummarizedMsgs.concat({
              role: "system",
              content: Locale.Store.Prompt.Summarize,
              date: "",
            }),
            {
              filterBot: false,
              onMessage(message, done) {
                session.memoryPrompt = message;
                if (done) {
                  console.log("[Memory] ", session.memoryPrompt);
                  session.lastSummarizeIndex = lastSummarizeIndex;
                }
              },
              onError(error) {
                console.error("[Summarize] ", error);
              },
            },
          );
        }
      },

      updateStat(message) {
        get().updateCurrentSession((session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },

      updateCurrentSession(updater) {
        const sessions = get().sessions;
        const index = get().currentSessionIndex;
        updater(sessions[index]);
        set(() => ({ sessions }));
      },

      clearAllData() {
        if (confirm(Locale.Store.ConfirmClearAll)) {
          localStorage.clear();
          location.reload();
        }
      },
    }),
    {
      name: LOCAL_KEY,
      version: 1.2,
      migrate(persistedState, version) {
        const state = persistedState as ChatStore;

        if (version === 1) {
          state.sessions.forEach((s) => (s.context = []));
        }

        if (version < 1.2) {
          state.sessions.forEach((s) => (s.sendMemory = true));
        }

        return state;
      },
    },
  ),
);
