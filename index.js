import fetch from 'node-fetch';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import UserAgent from 'user-agents';

dotenv.config();

const Tokens = [];
let tokenManager;
let redisClient;
let currentIndex = 0;
let sessionId = null;
const CONFIG = {
  API: {
    BASE_URL: process.env.DENO_URL || "https://partyrock.aws/stream/getCompletion",//如果需要多号循环，需要设置你自己的denourl
    API_KEY: process.env.API_KEY || "sk-123456",//自定义你自己的认证密钥，记得修改
    RedisUrl: process.env.RedisUrl,
    RedisToken: process.env.RedisToken
  },
  SERVER: {
    PORT: process.env.PORT || 3000,
    BODY_LIMIT: '5mb'
  },
  MODELS: {
    'claude-3-5-haiku-20241022': 'bedrock-anthropic.claude-3-5-haiku',
    'claude-3-5-sonnet-20241022': 'bedrock-anthropic.claude-3-5-sonnet-v2-0',
    'nova-lite-v1-0': 'bedrock-amazon.nova-lite-v1-0',
    'nova-pro-v1-0': 'bedrock-amazon.nova-pro-v1-0',
    'llama3-1-7b': 'bedrock-meta.llama3-1-8b-instruct-v1',
    'llama3-1-70b': 'bedrock-meta.llama3-1-70b-instruct-v1',
    'mistral-small': 'bedrock-mistral.mistral-small-2402-v1-0',
    'mistral-large': 'bedrock-mistral.mistral-large-2407-v1-0'
  },
  DEFAULT_HEADERS: {
    "request-id": "",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Cache-Control": "no-cache, no-store",
    "pragma": "no-cache",
    "Accept": "text/event-stream",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Content-Type": "application/json",
    "anti-csrftoken-a2z": "",
    "origin": "https://partyrock.aws",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "referer": "",
    "Cookie": "",
    "accept-language": "zh-CN,zh;q=0.9",
    "priority": "u=1, i"
  },
  CHROME_PATH: process.env.CHROME_PATH || "/usr/bin/chromium"
};
var RedisClient = class {
  constructor() {
    this.url = CONFIG.API.RedisUrl;
    this.token = CONFIG.API.RedisToken;
  }
  async get(key) {
    const response = await fetch(`${this.url}/get/${key}`, {
      headers: {
        Authorization: `Bearer ${this.token}`
      }
    });
    if (!response.ok) {
      console.log("redis获取内容失败", response.status);
    }
    const data = await response.json();
    return data.result;
  }
  async set(key, value) {
    const url = `${this.url}/set/${key}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`
      },
      body: `${value}`
    });
    if (!response.ok) {
      console.log("redis设置内容失败", response.status);
    }
  }
};
class TokenManager {
  async updateRedisTokens() {
    await redisClient.set(`tokens_${currentIndex}`, JSON.stringify(Tokens[currentIndex]));
  }
  async getRedisTokens() {
    var checkRedis = JSON.parse(await redisClient.get(`tokens_${currentIndex}`));
    return checkRedis;
  }

  async updateCacheTokens() {
    sessionId = Utils.uuidv4();
    CONFIG.DEFAULT_HEADERS["anti-csrftoken-a2z"] = Tokens[currentIndex].anti_csrftoken_a2z;
    CONFIG.DEFAULT_HEADERS.Cookie = `idToken=${Tokens[currentIndex].idToken}; pr_refresh_token=${Tokens[currentIndex].pr_refresh_token};aws-waf-token=${Tokens[currentIndex].aws_waf_token};cwr_s=${Tokens[currentIndex].cwr_s};cwr_u=${sessionId}`;
    CONFIG.DEFAULT_HEADERS.referer = Tokens[currentIndex].refreshUrl;
    CONFIG.DEFAULT_HEADERS["request-id"] = `request-id-${Utils.uuidv4()}`;
  }

  async updateTokens(response, isWaf = false) {
    if (isWaf) {
      var wafToken = await Utils.extractWaf();
      if (wafToken) {
        Tokens[currentIndex].aws_waf_token = wafToken;
        await this.updateCacheTokens();
        this.updateRedisTokens();
        currentIndex = (currentIndex + 1) % Tokens.length;
        console.log("成功提取 aws-waf-token");
      } else {
        currentIndex = (currentIndex + 1) % Tokens.length;
        await this.updateCacheTokens();
        console.log("提取aws-waf-token失败");
      }
    } else {
      const newCsrfToken = response.headers.get('anti-csrftoken-a2z');
      const cookies = response.headers.get('set-cookie');
      if (newCsrfToken && cookies) {
        console.log("更新缓存");
        Tokens[currentIndex].anti_csrftoken_a2z = newCsrfToken;
        const idTokenMatch = cookies.match(/idToken=([^;]+)/);
        if (idTokenMatch && idTokenMatch[1]) {
          Tokens[currentIndex].idToken = idTokenMatch[1];
        }
        this.updateRedisTokens();//最后更新redis数据库缓存,异步
        console.log("更新缓存完毕");
      }
      currentIndex = (currentIndex + 1) % Tokens.length;
    }
  }
}


class Utils {
  static async getRandomUserAgent() {
    try {
      let type = ["Win32", "MacIntel", "Linux x86_64"]
      const userAgent = new UserAgent({ platform: type[Math.floor(Math.random() * type.length)] });
      return userAgent.random().toString();
    } catch (error) {
      let type = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15"
      ]
      return type[Math.floor(Math.random() * type.length)]
    }
  }
  static async extractWaf() {
    puppeteer.use(StealthPlugin())
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      executablePath: CONFIG.CHROME_PATH
    });
    try {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        cookie: `pr_refresh_token=${Tokens[currentIndex].pr_refresh_token};idToken=${Tokens[currentIndex].idToken};aws-waf-token=${Tokens[currentIndex].aws_waf_token};cwr_s=${Tokens[currentIndex].cwr_s};cwr_u=${Utils.uuidv4()}`
      });
      await page.setUserAgent(
        CONFIG.DEFAULT_HEADERS["User-Agent"]
      )
      await page.goto(Tokens[currentIndex].refreshUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await page.evaluate(() => {
        // 随机滚动
        window.scrollBy(0, Math.random() * 500)
      })
      await page.evaluate(() => {
        return new Promise(resolve => setTimeout(resolve, 2000))
      })
      // 直接从页面 cookies 中提取 aws-waf-token
      const awsWafToken = (await page.cookies()).find(
        cookie => cookie.name.toLowerCase() === 'aws-waf-token'
      )?.value;

      if (awsWafToken) {
        await browser.close();
        return awsWafToken;
      } else {
        await browser.close();
        return null;
      }

    } catch (error) {
      console.error('获取 aws-waf-token 出错:', error);
      await browser.close();
      return null;
    }
  }

  static async extractTokens(cookieString) {
    const tokens = {};
    const cookiePairs = cookieString.split(';').map(pair => pair.trim());

    cookiePairs.forEach(pair => {
      const splitIndex = pair.indexOf('=');
      const key = pair.slice(0, splitIndex).trim();
      const value = pair.slice(splitIndex + 1).trim();

      tokens[key] = value;
    });

    return tokens;
  }
  // 获取数组中的随机元素
  static getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 生成UUID
  static uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // 生成随机十六进制字符串
  static generateRandomHexString(length) {
    let result = '';
    const characters = '0123456789ABCDEF';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }
}
async function initializeService() {
  console.log('服务初始化中...');
  tokenManager = new TokenManager();
  redisClient = new RedisClient();
  let index = 0;
  while (true) {
    console.log(index, '开始检测是否有缓存');
    // 使用 JSON.parse 确保正确解析
    var checkRedis = await redisClient.get(`tokens_${index}`);
    if (checkRedis) {
      // 尝试解析 JSON 字符串
      try {
        const parsedRedis = typeof checkRedis === 'string'
          ? JSON.parse(checkRedis)
          : checkRedis;
        Tokens.push({
          refreshUrl: parsedRedis.refreshUrl,
          anti_csrftoken_a2z: parsedRedis.anti_csrftoken_a2z,
          pr_refresh_token: parsedRedis.pr_refresh_token,
          aws_waf_token: parsedRedis.aws_waf_token,
          idToken: parsedRedis.idToken,
          cwr_s: parsedRedis.cwr_s
        });
        console.log(`成功添加第 ${index} 组 Token`);
      } catch (error) {
        console.error(`解析第 ${index} 组 Token 时出错:`, error);
      }
    } else {
      console.log(index, '没有缓存，开始提取环境变量');
      const refreshUrl = process.env[`AUTH_TOKENS_${index}_REFRESH_URL`];
      const anti_csrftoken_a2z = process.env[`AUTH_TOKENS_${index}_ANTI_CSRF_TOKEN`];
      const cookie = process.env[`AUTH_TOKENS_${index}_COOKIE`];

      if (!refreshUrl && !anti_csrftoken_a2z && !cookie) {
        break;
      }
      const cookies = await Utils.extractTokens(cookie);

      if (refreshUrl && anti_csrftoken_a2z && cookie) {
        Tokens.push({
          refreshUrl,
          anti_csrftoken_a2z,
          pr_refresh_token: cookies["pr_refresh_token"],
          aws_waf_token: cookies["aws-waf-token"],
          idToken: cookies["idToken"],
          cwr_s: cookies["cwr_s"]
        });
      }
    }
    index++;
  }
  console.log('服务初始化完毕');
}

await initializeService();

class ApiClient {
  constructor(modelId) {
    if (!CONFIG.MODELS[modelId]) {
      throw new Error(`不支持的模型: ${modelId}`);
    }
    this.modelId = CONFIG.MODELS[modelId];
  }

  processMessageContent(content) {
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      return content
        .map(item => item.text)
        .join('\n');
    }

    if (typeof content === 'object') return content.text || null;
    return null;
  }

  //合并相同role的消息
  async transformMessages(request) {
    const mergedMessages = await request.messages.reduce(async (accPromise, current) => {
      const acc = await accPromise;
      const lastMessage = acc[acc.length - 1];
      if (lastMessage && lastMessage.role == "system") {
        lastMessage.role = "user"
      }
      if (current && current.role == "system") {
        current.role = "user"
      }
      const currentContent = this.processMessageContent(current.content);

      if (currentContent === null) return acc;

      if (lastMessage && current && (lastMessage.role == current.role)) {
        const lastContent = this.processMessageContent(lastMessage.content);
        if (lastContent !== null) {
          lastMessage.content = [
            {
              "text": `${lastContent}\r\n${currentContent}`
            }
          ];
          return acc;
        }
      }
      current.content = [
        {
          "text": currentContent
        }
      ]
      acc.push(current);
      return acc;
    }, Promise.resolve([]));
    // 处理请求参数
    let topP = request.top_p || 0.5;
    let temperature = request.temperature || 0.95;
    if (topP >= 1) {
      topP = 1;
    }
    if (temperature >= 1) {
      temperature = 1;
    }
    const extractPartyRockId = url => url.match(/https:\/\/partyrock\.aws\/u\/[^/]+\/([^/]+)/)?.[1];
    console.log("当前请求的是", CONFIG.DEFAULT_HEADERS.referer);

    const requestPayload = {
      "messages": mergedMessages,
      "modelName": this.modelId,
      "context": {
        "type": "chat-widget",
        "appId": extractPartyRockId(CONFIG.DEFAULT_HEADERS.referer)
      },
      "options": {
        "temperature": temperature,
        "topP": topP
      },
      "apiVersion": 3
    }
    return requestPayload;
  }
}
class MessageProcessor {
  static createChatResponse(message, model, isStream = false) {
    const baseResponse = {
      id: `chatcmpl-${Utils.uuidv4()}`,
      created: Math.floor(Date.now() / 1000),
      model: model
    };

    if (isStream) {
      return {
        ...baseResponse,
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: { content: message }
        }]
      };
    }

    return {
      ...baseResponse,
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: message
        },
        finish_reason: 'stop'
      }],
      usage: null
    };
  }
}
class ResponseHandler {
  static async handleStreamResponse(response, model, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const stream = response.body;
      let buffer = '';
      let decoder = new TextDecoder('utf-8');
      stream.on('data', (chunk) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (!data) continue;
            if (data == "[DONE]") {
              res.write('data: [DONE]\n\n');
              return res.end();
            }
            try {
              const json = JSON.parse(data);
              if (json?.text) {
                var content = json.text;
                const responseData = MessageProcessor.createChatResponse(content, model, true);
                res.write(`data: ${JSON.stringify(responseData)}\n\n`);
              }
            } catch (error) {
              console.error('JSON解析错误:', error);
            }
          }
        }
      });
      stream.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });
      stream.on('error', (error) => {
        console.error('流处理错误:', error);
        res.write('data: [DONE]\n\n');
        res.end();
      });

    } catch (error) {
      console.error('处理响应错误:', error);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  static async handleNormalResponse(response, model, res) {
    const text = await response.text();
    const lines = text.split("\n");
    let fullResponse = '';

    for (let line of lines) {
      line = line.trim();
      if (line) {
        if (line.startsWith('data: ')) {
          let data = line.substring(6);
          if (data === '[DONE]') break;
          try {
            let json = JSON.parse(data)
            if (json?.text) {
              fullResponse += json.text;
            }
          } catch (error) {
            console.log("json解析错误");
            continue
          }
        }
      }
    }
    const responseData = MessageProcessor.createChatResponse(fullResponse, model);
    res.json(responseData);
  }
}
// Express 应用设置
const app = express();
app.use(express.json({ limit: CONFIG.SERVER.BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.SERVER.BODY_LIMIT }));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['*']
}));
// 路由处理
app.get('/hf/v1/models', (req, res) => {
  res.json({
    object: "list",
    data: Object.keys(CONFIG.MODELS).map((model, index) => ({
      id: model,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "partyrock",
    }))
  });
});

app.post('/hf/v1/chat/completions', async (req, res) => {
  var reqStatus = 500;
  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    if (authToken !== CONFIG.API.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    await tokenManager.updateCacheTokens();
    const apiClient = new ApiClient(req.body.model);
    const requestPayload = await apiClient.transformMessages(req.body);
    
    try {
      console.log("开始请求");
      //发送请求
      var response = await fetch(`${CONFIG.API.BASE_URL}`, {
        method: "POST",
        headers: {
          ...CONFIG.DEFAULT_HEADERS
        },
        body: JSON.stringify(requestPayload)
      });
      reqStatus = response.status;
      switch (reqStatus) {
        case 200:
          console.log("请求成功");
          // 异步更新token
          tokenManager.updateTokens(response)
          // 处理响应
          if (req.body.stream) {
            await ResponseHandler.handleStreamResponse(response, req.body.model, res);
          } else {
            await ResponseHandler.handleNormalResponse(response, req.body.model, res);
          }
          return;
        case 202:
          console.log("请求受限，更新WAF");
          await tokenManager.updateTokens(response, true);
          throw new Error(`请求失败! status: ${response.statusText}，已刷新验证信息，请重新请求`);
        case 405:
          console.log("人机验证");
          await tokenManager.updateTokens(response, true);//尝试获取waf，然后返回错误提示。
          throw new Error(`请求失败! status: ${response.statusText}，人机验证，请重新请求，如果多次失败，请重新更换token`);
        case 400:
          console.log("信息过期，请求失败");
          await tokenManager.updateTokens(response);
          throw new Error(`请求失败! status: ${response.statusText}，已刷新验证信息，请重新请求`);
        case 403:
          console.log("请求被阻止");
          await tokenManager.updateTokens(response, true);//尝试获取waf，然后返回错误提示。
          CONFIG.DEFAULT_HEADERS["User-Agent"] = await Utils.getRandomUserAgent();
          throw new Error(`请求失败! status: ${response.statusText}，请重新请求，如果多次失败，请重新更换token`);
        default:
          throw new Error(`请求失败! status: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`请求失败! status: ${response.status}`);
    }
  } catch (error) {
    res.status(parseInt(reqStatus)).json({
      error: {
        message: error.message,
        type: 'server_error',
        param: null,
        code: error.code || null
      }
    });
  }
});


app.use((req, res) => {
  res.status(404).send("API服务运行正常，，请使用正确请求路径");
});

// 启动服务器
app.listen(CONFIG.SERVER.PORT, () => {
  console.log(`服务器运行在端口 ${CONFIG.SERVER.PORT} `);
});