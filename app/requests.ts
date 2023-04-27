import type { ChatRequest, ChatResponse } from "./api/openai/typing";
import { Message, ModelConfig, useAccessStore, useChatStore } from "./store";
import { showToast } from "./components/ui-lib";

const TIME_OUT_MS = 60000; // 设定网络请求超时时间为 60 秒

// 根据传入的消息数组和选项，构建发送给 OpenAI API 的聊天请求参数对象
const makeRequestParam = (
  messages: Message[],
  options?: {
    filterBot?: boolean; // 是否过滤聊天机器人的回复
    stream?: boolean; // 是否启用流式聊天
  },
): ChatRequest => {
  let sendMessages = messages.map((v) => ({
    role: v.role,
    content: v.content,
  }));

  if (options?.filterBot) {
    sendMessages = sendMessages.filter((m) => m.role !== "assistant");
  }

  // 获取 store 中的聊天配置信息
  const modelConfig = { ...useChatStore.getState().config.modelConfig };

  // 在这里删除掉了 max_tokens 参数，因为对于普通用户而言，其意义不大
  // @ts-expect-error
  delete modelConfig.max_tokens;

  return {
    messages: sendMessages, // 聊天消息数组
    stream: options?.stream, // 是否启用流式聊天
    ...modelConfig, // 聊天模型的配置信息
  };
};

// 获取请求头信息
function getHeaders() {
  const accessStore = useAccessStore.getState();
  let headers: Record<string, string> = {};

  if (accessStore.enabledAccessControl()) { // 检查是否启用了访问控制
    headers["access-code"] = accessStore.accessCode; // 访问控制码
  }

  if (accessStore.token && accessStore.token.length > 0) { // 检查是否有 token
    headers["token"] = accessStore.token; // 将 token 添加到 headers 中
  }

  return headers;
}

// 构造请求 OpenAI API 的函数
export function requestOpenaiClient(path: string) {
  // 返回一个函数，这个函数用于发送请求给 OpenAI API
  return (body: any, method = "POST") =>
    fetch("/api/openai?_vercel_no_cache=1", { // 这里是请求地址，需要替换成实际的 API 地址，并在 URL 后面加上 '_vercel_no_cache=1' 避免 URL 被缓存
      method,
      headers: {
        "Content-Type": "application/json", // 请求体的类型
        path, // API 路径
        ...getHeaders(), // 请求头部信息
      },
      body: body && JSON.stringify(body), // 请求体
    });
}

// 请求聊天 API，并返回聊天响应
export async function requestChat(messages: Message[]) {
  const req: ChatRequest = makeRequestParam(messages, { filterBot: true }); // 构造聊天请求参数

  const res = await requestOpenaiClient("v1/chat/completions")(req); // 发送请求

  try {
    const response = (await res.json()) as ChatResponse; // 解析响应
    return response; // 返回响应
  } catch (error) {
    console.error("[Request Chat] ", error, res.body);
  }
}

// 请求用量信息
export async function requestUsage() {
  const formatDate = (d: Date) =>
    `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
      .getDate()
      .toString()
      .padStart(2, "0")}`;
  const ONE_DAY = 2 * 24 * 60 * 60 * 1000;
  const now = new Date(Date.now() + ONE_DAY);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startDate = formatDate(startOfMonth);
  const endDate = formatDate(now);

  // 获取聊天用量信息
  const [used, subs] = await Promise.all([
    requestOpenaiClient(
      `dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
    )(null, "GET"),
    requestOpenaiClient("dashboard/billing/subscription")(null, "GET"),
  ]);

  const response = (await used.json()) as {
    total_usage?: number;
    error?: {
      type: string;
      message: string;
    };
  };

  const total = (await subs.json()) as {
    hard_limit_usd?: number;
  };

  if (response.error && response.error.type) {
    showToast(response.error.message);
    return;
  }

  if (response.total_usage) {
    response.total_usage = Math.round(response.total_usage) / 100;
  }

  if (total.hard_limit_usd) {
    total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
  }

  return {
    used: response.total_usage, // 当月使用量
    subscription: total.hard_limit_usd, // 订阅限额
  };
}

// 请求聊天流 API
export async function requestChatStream(
  messages: Message[],
  options?: {
    filterBot?: boolean; // 是否过滤聊天机器人的回复
    modelConfig?: ModelConfig; // 聊天模型的配置信息
    onMessage: (message: string, done: boolean) => void; // 每次接收到消息都会触发这个回调
    onError: (error: Error, statusCode?: number) => void; // 出现错误时触发的回调
    onController?: (controller: AbortController) => void; // 控制器回调函数
  },
) {
  const req = makeRequestParam(messages, {
    stream: true, // 启用流式聊天
    filterBot: options?.filterBot,
  });

  console.log("[Request] ", req);

  const controller = new AbortController();
  const reqTimeoutId = setTimeout(() => controller.abort(), TIME_OUT_MS); // 超时时间

  try {
    const res = await fetch("/api/chat-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", // 请求体的类型
        path: "v1/chat/completions", // API 路径
        ...getHeaders(), // 请求头部信息
      },
      body: JSON.stringify(req), // 请求体
      signal: controller.signal, // 控制器信号
    });
    clearTimeout(reqTimeoutId); // 如果在超时时间内完成请求，则清除计时器

    let responseText = "";

    const finish = () => {
      options?.onMessage(responseText, true); // 一旦聊天流传输完毕，即触发回调函数
      controller.abort(); // 清空控制器
    };

    if (res.ok) {
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      options?.onController?.(controller); // 在这里触发传入的控制器回调函数

      while (true) {
        const resTimeoutId = setTimeout(() => finish(), TIME_OUT_MS); // 聊天流超时时间
        const content = await reader?.read();
        clearTimeout(resTimeoutId); // 如果在超时时间内完成请求，则清除计时器

        if (!content || !content.value) {
          break;
        }

        const text = decoder.decode(content.value, { stream: true });
        responseText += text;

        const done = content.done;
        options?.onMessage(responseText, false); // 每当接收到新的消息时都会触发该回调函数

        if (done) {
          break;
        }
      }

      finish();
    } else if (res.status === 401) { // 当请求凭证不正确时（401 错误），触发错误回调函数
      console.error("Unauthorized");
      options?.onError(new Error("Unauthorized"), res.status);
    } else {
      console.error("Stream Error", res.body);
      options?.onError(new Error("Stream Error"), res.status); // 当遇到其它错误时，也会触发该回调函数，并返回错误状态码
    }
  } catch (err) { // 如果出现网络错误，也会触发错误回调函数
    console.error("NetWork Error", err);
    options?.onError(err as Error);
  }
}

// 根据传入消息数组和提示文本，发送请求并返回聊天响应
export async function requestWithPrompt(messages: Message[], prompt: string) {
  messages = messages.concat([
    {
      role: "user",
      content: prompt,
      date: new Date().toLocaleString(),
    },
  ]);

  const res = await requestChat(messages);

  return res?.choices?.at(0)?.message?.content ?? "";
}

// 控制器对象，用于管理聊天流的控制器
export const ControllerPool = {
  controllers: {} as Record<string, AbortController>, // 控制器字典

  // 添加控制器，并返回对应的键值
  addController(
    sessionIndex: number,
    messageId: number,
    controller: AbortController,
  ) {
    const key = this.key(sessionIndex, messageId); // 获取键值
    this.controllers[key] = controller; // 将控制器存入字典
    return key; // 返回对应的键值
  },

  // 停止指定键值对应的控制器
  stop(sessionIndex: number, messageId: number) {
    const key = this.key(sessionIndex, messageId); // 获取键值
    const controller = this.controllers[key]; // 获取对应的控制器
    controller?.abort(); // 如果控制器存在，则终止该聊天流请求
  },

  // 停止所有控制器
  stopAll() {
    Object.values(this.controllers).forEach((v) => v.abort()); // 遍历控制器字典，终止所有聊天流请求
  },

  // 检查是否有待处理的聊天流请求
  hasPending() {
    return Object.values(this.controllers).length > 0; // 如果控制器字典非空，则表示有待处理的聊天流请求
  },

  // 删除指定键值对应的控制器
  remove(sessionIndex: number, messageId: number) {
    const key = this.key(sessionIndex, messageId); // 获取键值
    delete this.controllers[key]; // 从控制器字典中删除对应的键值
  },

  // 构造控制器键值
  key(sessionIndex: number, messageIndex: number) {
    return `${sessionIndex},${messageIndex}`; // 返回拼接后的键值字符串
  },
};

