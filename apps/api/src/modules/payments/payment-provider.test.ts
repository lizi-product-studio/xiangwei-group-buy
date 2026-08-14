import { createCipheriv, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WechatPlatformPaymentProvider } from './payment-provider.js';

const temporaryDirectories:string[]=[];
afterEach(()=>{for(const directory of temporaryDirectories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('WechatPlatformPaymentProvider callback security',()=>{
  it('verifies the RSA signature and decrypts an AES-256-GCM payment notification',()=>{
    const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
    const directory=mkdtempSync(join(tmpdir(),'hometown-payment-'));temporaryDirectories.push(directory);
    const privateKeyPath=join(directory,'merchant-private.pem');const publicKeyPath=join(directory,'wechat-public.pem');
    writeFileSync(privateKeyPath,privateKey);writeFileSync(publicKeyPath,publicKey);
    const apiV3Key='0123456789abcdef0123456789abcdef';const nonce='payment12345';const associatedData='transaction';
    const plaintext=JSON.stringify({combine_out_trade_no:'HT202608100001',combine_transaction_id:'4200000000001',sub_orders:[{amount:{total_amount:5960}}]});
    const cipher=createCipheriv('aes-256-gcm',Buffer.from(apiV3Key),Buffer.from(nonce));cipher.setAAD(Buffer.from(associatedData));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]).toString('base64');
    const rawBody=JSON.stringify({id:'EV-PAYMENT-1',event_type:'COMBINE_TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',ciphertext,associated_data:associatedData,nonce}});
    const timestamp=String(Math.floor(Date.now()/1000));const callbackNonce='callback-nonce';
    const signature=sign('RSA-SHA256',Buffer.from(`${timestamp}\n${callbackNonce}\n${rawBody}\n`),privateKey).toString('base64');
    const provider=new WechatPlatformPaymentProvider({appId:'wx-test',spMchid:'12345678',certificateSerial:'SERIAL-123',privateKeyPath,publicKeyId:'PUB_KEY_ID_1',publicKeyPath,apiV3Key,notifyUrl:'https://example.com/notify',refundNotifyUrl:'https://example.com/refund-notify',platformName:'示例平台有限公司'});
    const notification=provider.parseNotification(rawBody,{'wechatpay-timestamp':timestamp,'wechatpay-nonce':callbackNonce,'wechatpay-signature':signature,'wechatpay-serial':'PUB_KEY_ID_1'});
    expect(notification).toMatchObject({eventId:'EV-PAYMENT-1',orderNo:'HT202608100001',providerPaymentId:'4200000000001',amountCents:5960});
    expect(()=>provider.parseNotification(`${rawBody} `,{'wechatpay-timestamp':timestamp,'wechatpay-nonce':callbackNonce,'wechatpay-signature':signature,'wechatpay-serial':'PUB_KEY_ID_1'})).toThrow('微信支付签名无效');
  });
});
