import * as crypto from 'crypto';
import cloud from '@lafjs/cloud';
import cron from 'node-cron';

const db = cloud.database();
const token = '你公众号配置的token';

function verifySignature(signature, timestamp, nonce, token) {
  const arr = [token, timestamp, nonce].sort();
  const str = arr.join('');
  const sha1 = crypto.createHash('sha1');
  sha1.update(str);
  return sha1.digest('hex') === signature;
}

export async function main(data, context) {
  const { signature, timestamp, nonce, echostr } = data.query;

  if (!verifySignature(signature, timestamp, nonce, token)) {
    return 'Invalid signature';
  }

  if (echostr) {
    return echostr;
  }

  const { fromusername, tousername, content, msgtype, event } = data.body.xml;

  if (msgtype === 'event') {
    let msg = '';
    if (event === 'subscribe') {
      msg = '感谢您的订阅，您可以直接在输入框和chatgpt沟通!';
      console.log(`收到公众号用户(${fromusername})订阅，回复:${msg}`);
      return buildXml(fromusername, tousername, msg);
    } else {
      msg = '感恩有你，期待下次相见!';
      console.log(`收到公众号用户(${fromusername})取消订阅，回复:${msg}`);
      return buildXml(fromusername, tousername, msg);
    }
  }

  console.log(`收到公众号用户(${fromusername})请求:${content[0]}`);

  if (content[0] === '继续') {
    const chatData = await db.collection(fromusername.toString()).get();
    const lastMessage = chatData.data[chatData.data.length - 1];

    if (lastMessage) {
      const msg = `${lastMessage.data.problem}\n\nchatgpt:\n${lastMessage.data.message}`;
      await db.collection(fromusername.toString()).where({}).remove();
      console.log(`回复公众号用户(${fromusername})响应:${msg}`);
      return buildXml(fromusername, tousername, msg);
    } else {
      const msg = "内容较长，正在生成中，请稍后回复'继续!'";
      console.log(`回复公众号用户(${fromusername})响应:${msg}`);
      return buildXml(fromusername, tousername, msg);
    }
  }

  const doc = await db.collection('limit_user').doc(fromusername.toString()).get();

  if (doc.data) {
    let count = doc.data.data.count;
    if (count > 40) {
      const msg = "非常抱歉，今日您的访问次数已经超出限制，请明天再来!";
      console.log(`回复公众号用户(${fromusername})响应:${msg}`);
      return buildXml(fromusername, tousername, msg);
    }
    let addCount = count + 1;
    await db.collection('limit_user').doc(fromusername.toString()).set({
      data: { 'count': addCount }
    });
  } else {
    await db.collection('limit_user').doc(fromusername.toString()).set({
      data: { 'count': 1 }
    });
  }

  await sendGpt(fromusername.toString(), content[0].toString());

  const msg = "chatgpt正在响应，请稍后回复'继续'获取!";
  console.log(`回复公众号用户(${fromusername})响应:${msg}`);
  return buildXml(fromusername, tousername, msg);
}

function buildXml(fromusername, tousername, content) {
  return `
    <xml>
      <ToUserName><![CDATA[${fromusername}]]></ToUserName>
      <FromUserName><![CDATA[${tousername}]]></FromUserName>
      <CreateTime>${Date.now()}</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[${content}]]></Content>
    </xml>
  `;
}

async function sendGpt(name, msg) {
  console.log(`公众号用户(${name})请求chat_gpt`);

  const { ChatGPTAPI } = await import('chatgpt');
  const apiKey = 'Your_ChatGPT_API_Key';
  let api = cloud.shared.get('api');

  if (!api) {
    api = new ChatGPTAPI({ apiKey });
    cloud.shared.set('api', api);
  }

  const chatData = await db.collection("context-" + name).get();
  await db.collection("context-" + name).where({}).remove();
  const last = chatData.data[chatData.data.length - 1];

  let response;

  if (last) {
    response = await api.sendMessage(msg, { parentMessageId: last.data.parentMessageId });
  } else {
    response = await api.sendMessage(msg);
  }

  console.log(`chat_gpt响应${msg}，响应: ${JSON.stringify(response)}`);

  try {
    await db.collection("context-" + name).add({ data: { parentMessageId: response.parentMessageId } });
    await db.collection(name).add({ data: { problem: msg, message: response.text } });
    console.log('同步数据库成功');
  } catch (error) {
    console.log('数据同步失败', error);
  }
}
