# partyrock2api
基于partyrock的转openAI服务,抱脸部署
## 支持模型
- claude-3-5-haiku-20241022
- claude-3-5-sonnet-20241022
- nova-lite-v1-0
- nova-pro-v1-0
- llama3-1-7b
- llama3-1-70b
- mistral-small
- mistral-large

## 请求格式
已转换为OpenAI格式，支持非流与流式请求，支持temperature与topP传参：

## 获取模型列表
```curl https:/http://127.0.0.1:7860/v1/models 
```
## 聊天请求
```curl https://http://127.0.0.1:7860/v1/chat/completions \
-H "Content-Type: application/json" \
-H "Authorization: Bearer YOUR_API_KEY" \
-d '{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    {
      "role": "user", 
      "content": "Hello, can you help me?"
    }
  ],
  "temperature": 0.7,
  "topP": 1
}'
```
## 抱脸部署
下载文件，创建新的docker抱脸项目，然后上传文件，等待运行即可

## 本地docker部署
下载文件，然后创建镜像。

```docker build -t youname/partyrock2api .
```
docker运行
```docker run -it -d --name partyrock2api \
  --network=my_custom_network \
  -p 7860:7860 \
  -e API_KEY=your_api_key \
  -e RedisUrl=your_RedisUrl \
  -e RedisToken=your_RedisUrl \
  -e AUTH_TOKENS_0_REFRESH_URL=your_referer \
  -e AUTH_TOKENS_0_ANTI_CSRF_TOKEN=your_partyrock_anti-csrftoken-a2z\
  -e AUTH_TOKENS_0_COOKIE=your_ partyrockCookie \
  -e PORT=7860 \
  youname/partyrock2api:latest
```
## 端口
- 默认端口：7860

## 主要变量参数获取方式
1、打开登录这个网站[partyrock](https://partyrock.aws/)，然后创建一个聊天app.
![image](https://github.com/user-attachments/assets/6df5667e-9726-4e83-a333-e4bd06e7f0f2)

2、先打开f12，进入network界面，然后进行对话，完整复制下面的信息，分别为anti-csrftoken-a2z，Referer, Cookie的值，最好对话两次再获取cookie的值，有可能第一次没有验证用的waf cookie，导致后面报错400。
![image](https://github.com/user-attachments/assets/b6af3cd8-5cea-4488-b804-ae07525c8a0e)

![image](https://github.com/user-attachments/assets/73323b2d-000d-42de-973b-b8ed0eb7cef5)

3、redis保护需要的token获取方式
注册账号后创建数据库选择免费计划，然后在这里获取url和认证密钥填入环境变量。
![image](https://github.com/user-attachments/assets/1c8afafa-ea18-43d0-92ba-0d5b4723e744)

4、抱脸ip可能被封，可能需要反代，才能正常使用
创建deno账号创建项目，复制如下代码，然后获取url
```import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PROXY_DOMAIN = "https://partyrock.aws/stream/getCompletion";
const PORT = 8080;

async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const targetUrl = `${PROXY_DOMAIN}${url.pathname}${url.search}`;

    const proxyResponse = await fetch(targetUrl, {
      headers: req.headers,
      method: req.method,
      body: req.body
    });

    // 返回代理响应，保留状态码和响应头
    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      headers: proxyResponse.headers
    });
  } catch (error) {
    console.error("代理请求失败:", error);
    return new Response("代理服务器错误", { status: 500 });
  }
}
serve(handler, { port: PORT });
```
![image](https://github.com/user-attachments/assets/61f9d02d-90b4-4276-8d9b-cfbc932a4387)

![image](https://github.com/user-attachments/assets/c3aef6cd-2582-4077-ad2b-067d8e7756ca)

## 声明
请勿用于商业用途。
