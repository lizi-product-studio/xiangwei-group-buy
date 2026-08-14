import { constants, createDecipheriv, createHash, publicEncrypt, randomBytes, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BusinessError } from '@hometown/domain';
import type { Merchant, Order } from '../core/types.js';

export interface PaymentInitiation {
  providerPaymentId: string | null;
  clientPayload: Record<string,string>;
  providerContext:Record<string,unknown>;
}

export interface PaymentNotification {
  eventId:string; type:string; orderNo:string; providerPaymentId:string; amountCents:number; bodyHash:string;subTransactions:Array<{outTradeNo:string;transactionId:string}>;
}
export interface RefundRequest {providerRefundNo:string;subMchid:string|null;outTradeNo:string;amountCents:number;totalCents:number}
export interface RefundResult {providerRefundId:string|null;status:'PROCESSING'|'SUCCEEDED'|'FAILED'}
export interface RefundNotification {eventId:string;type:string;providerRefundNo:string;providerRefundId:string|null;status:'PROCESSING'|'SUCCEEDED'|'FAILED';bodyHash:string}
export interface SettlementRequest {subMchid:string|null;transactionId:string|null;outOrderNo:string;commissionCents:number}
export interface SettlementResult {providerOrderId:string|null;status:'PROCESSING'|'SUCCEEDED'|'FAILED'}

export interface PaymentProvider {
  readonly name:'mock'|'wechat-platform';
  initiate(order:Order,payerOpenId:string|null,merchants:Merchant[]):Promise<PaymentInitiation>;
  parseNotification(rawBody:string,headers:Record<string,string|undefined>):PaymentNotification;
  refund(input:RefundRequest):Promise<RefundResult>;
  queryRefund(input:Pick<RefundRequest,'providerRefundNo'|'subMchid'>):Promise<RefundResult>;
  parseRefundNotification(rawBody:string,headers:Record<string,string|undefined>):RefundNotification;
  settle(input:SettlementRequest):Promise<SettlementResult>;
  querySettlement(input:SettlementRequest):Promise<SettlementResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  public readonly name='mock' as const;
  public async initiate(order:Order):Promise<PaymentInitiation>{return order.paymentRoute==='PLATFORM_DIRECT'?{providerPaymentId:null,clientPayload:{mock:'true'},providerContext:{paymentRoute:'PLATFORM_DIRECT',outTradeNo:order.orderNo}}:{providerPaymentId:null,clientPayload:{mock:'true'},providerContext:{subOrders:order.merchantOrders.map((item)=>({merchantOrderId:item.id,subMchid:null,outTradeNo:item.id,amountCents:Number(item.itemAmountCents),transactionId:`MOCK-TX-${item.id}`}))}};}
  public parseNotification():PaymentNotification{throw new BusinessError('FORBIDDEN','模拟支付不接收外部回调',403);}
  public async refund():Promise<RefundResult>{return{providerRefundId:`MOCK-REFUND-${Date.now()}`,status:'SUCCEEDED'};}
  public async queryRefund():Promise<RefundResult>{return{providerRefundId:null,status:'SUCCEEDED'};}
  public parseRefundNotification():RefundNotification{throw new BusinessError('FORBIDDEN','模拟支付不接收外部回调',403);}
  public async settle():Promise<SettlementResult>{return{providerOrderId:`MOCK-SETTLEMENT-${Date.now()}`,status:'SUCCEEDED'};}
  public async querySettlement():Promise<SettlementResult>{return{providerOrderId:null,status:'SUCCEEDED'};}
}

export interface WechatPaymentConfig {
  appId:string; spMchid:string; certificateSerial:string; privateKeyPath:string;
  publicKeyId:string; publicKeyPath:string; apiV3Key:string; notifyUrl:string; refundNotifyUrl:string;platformName:string; platformMchid?:string;platformCertificateSerial?:string;platformPrivateKeyPath?:string;
}

interface WechatEncryptedResource {algorithm:string;ciphertext:string;associated_data?:string;nonce:string}

export class WechatPlatformPaymentProvider implements PaymentProvider {
  public readonly name='wechat-platform' as const;
  private readonly privateKey:string;
  private readonly platformPrivateKey:string;
  private readonly publicKey:string;

  public constructor(private readonly config:WechatPaymentConfig){
    this.privateKey=readFileSync(config.privateKeyPath,'utf8');
    this.platformPrivateKey=config.platformPrivateKeyPath?readFileSync(config.platformPrivateKeyPath,'utf8'):this.privateKey;
    this.publicKey=readFileSync(config.publicKeyPath,'utf8');
  }

  public async initiate(order:Order,payerOpenId:string|null,merchants:Merchant[]):Promise<PaymentInitiation>{
    if(!payerOpenId)throw new BusinessError('VALIDATION_ERROR','支付用户缺少微信 OpenID',409);
    if(order.paymentRoute==='PLATFORM_DIRECT'){
      const platformMchid=this.config.platformMchid??this.config.spMchid;
      const response=await this.request<{prepay_id:string}>('POST','/v3/pay/transactions/jsapi',{appid:this.config.appId,mchid:platformMchid,out_trade_no:order.orderNo,description:`${this.config.platformName}平台订单`.slice(0,127),notify_url:this.config.notifyUrl,amount:{total:Number(order.totalCents),currency:'CNY'},payer:{openid:payerOpenId}},platformMchid,true);
      const timestamp=String(Math.floor(Date.now()/1000));const nonceStr=randomBytes(16).toString('hex');const packageValue=`prepay_id=${response.prepay_id}`;const paySign=this.sign(`${this.config.appId}\n${timestamp}\n${nonceStr}\n${packageValue}\n`);
      return{providerPaymentId:response.prepay_id,clientPayload:{timeStamp:timestamp,nonceStr,package:packageValue,signType:'RSA',paySign},providerContext:{paymentRoute:'PLATFORM_DIRECT',outTradeNo:order.orderNo}};
    }
    if(order.merchantOrders.length>50)throw new BusinessError('VALIDATION_ERROR','单次合单最多支持 50 个商户订单',409);
    const merchantMap=new Map(merchants.map((merchant)=>[merchant.id,merchant]));
    const subOrders=order.merchantOrders.map((merchantOrder,index)=>{
      const merchant=merchantMap.get(merchantOrder.merchantId);
      if(!merchant?.wechatSubMchid)throw new BusinessError('VALIDATION_ERROR',`商户 ${merchant?.name??merchantOrder.merchantId} 尚未完成微信二级商户进件`,409);
      return{
        mchid:this.config.spMchid,
        sub_mchid:merchant.wechatSubMchid,
        out_trade_no:`${order.orderNo}${String(index+1).padStart(2,'0')}`.slice(0,32),
        description:`${merchant.name}家乡美食订单`.slice(0,127),
        amount:{total_amount:Number(merchantOrder.itemAmountCents),currency:'CNY'},
        attach:order.id,
        profit_sharing:true,
      };
    });
    const expireAt=new Date(order.expiresAt).toISOString().replace('.000Z','+00:00');
    const response=await this.request<{prepay_id:string}>('POST','/v3/combine-transactions/miniprogram',{
      combine_appid:this.config.appId,combine_mchid:this.config.spMchid,combine_out_trade_no:order.orderNo,
      time_expire:expireAt,notify_url:this.config.notifyUrl,sub_orders:subOrders,
      combine_payer_info:{openid:payerOpenId},
    });
    const timestamp=String(Math.floor(Date.now()/1000));
    const nonceStr=randomBytes(16).toString('hex');
    const packageValue=`prepay_id=${response.prepay_id}`;
    const paySign=this.sign(`${this.config.appId}\n${timestamp}\n${nonceStr}\n${packageValue}\n`);
    return{providerPaymentId:response.prepay_id,clientPayload:{timeStamp:timestamp,nonceStr,package:packageValue,signType:'RSA',paySign},providerContext:{subOrders:subOrders.map((item,index)=>({merchantOrderId:order.merchantOrders[index]!.id,subMchid:item.sub_mchid,outTradeNo:item.out_trade_no,amountCents:item.amount.total_amount}))}};
  }

  public parseNotification(rawBody:string,headers:Record<string,string|undefined>):PaymentNotification{
    this.verifyMessage(rawBody,headers);
    const envelope=JSON.parse(rawBody) as {id:string;event_type:string;resource:WechatEncryptedResource};
    const decrypted=this.decrypt(envelope.resource) as {combine_out_trade_no?:string;combine_transaction_id?:string;sub_orders?:Array<{out_trade_no?:string;transaction_id?:string;amount?:{total_amount?:number}}> ;out_trade_no?:string;transaction_id?:string;amount?:{total?:number}};
    const orderNo=decrypted.combine_out_trade_no??decrypted.out_trade_no;const amount=decrypted.combine_out_trade_no?(decrypted.sub_orders??[]).reduce((sum,item)=>sum+Number(item.amount?.total_amount??0),0):Number(decrypted.amount?.total);
    const providerPaymentId=decrypted.combine_transaction_id??decrypted.transaction_id??decrypted.sub_orders?.[0]?.transaction_id;
    if(!envelope.id||!orderNo||!providerPaymentId||!Number.isSafeInteger(amount))throw new BusinessError('VALIDATION_ERROR','微信支付回调内容不完整',400);
    const subTransactions=(decrypted.sub_orders??[]).filter((item)=>item.out_trade_no&&item.transaction_id).map((item)=>({outTradeNo:item.out_trade_no!,transactionId:item.transaction_id!}));
    return{eventId:envelope.id,type:envelope.event_type,orderNo,providerPaymentId,amountCents:amount,bodyHash:createHash('sha256').update(rawBody).digest('hex'),subTransactions};
  }

  public async refund(input:RefundRequest):Promise<RefundResult>{
    const body={...(input.subMchid?{sub_mchid:input.subMchid}:{}),out_trade_no:input.outTradeNo,out_refund_no:input.providerRefundNo,reason:'平台订单退款',notify_url:this.config.refundNotifyUrl,amount:{refund:input.amountCents,total:input.totalCents,currency:'CNY'}};
    const response=await this.request<{refund_id?:string;status?:string}>('POST','/v3/refund/domestic/refunds',body,input.subMchid?this.config.spMchid:(this.config.platformMchid??this.config.spMchid),!input.subMchid);
    return{providerRefundId:response.refund_id??null,status:this.refundStatus(response.status)};
  }
  public async queryRefund(input:Pick<RefundRequest,'providerRefundNo'|'subMchid'>):Promise<RefundResult>{
    const path=`/v3/refund/domestic/refunds/${encodeURIComponent(input.providerRefundNo)}${input.subMchid?`?sub_mchid=${encodeURIComponent(input.subMchid)}`:''}`;
    const response=await this.request<{refund_id?:string;status?:string}>('GET',path,undefined,input.subMchid?this.config.spMchid:(this.config.platformMchid??this.config.spMchid),!input.subMchid);
    return{providerRefundId:response.refund_id??null,status:this.refundStatus(response.status)};
  }
  public parseRefundNotification(rawBody:string,headers:Record<string,string|undefined>):RefundNotification{
    this.verifyMessage(rawBody,headers);
    const envelope=JSON.parse(rawBody) as{id:string;event_type:string;resource:WechatEncryptedResource};
    const decrypted=this.decrypt(envelope.resource) as{out_refund_no:string;refund_id?:string;refund_status?:string};
    if(!envelope.id||!decrypted.out_refund_no)throw new BusinessError('VALIDATION_ERROR','微信退款回调内容不完整',400);
    return{eventId:envelope.id,type:envelope.event_type,providerRefundNo:decrypted.out_refund_no,providerRefundId:decrypted.refund_id??null,status:this.refundStatus(decrypted.refund_status),bodyHash:createHash('sha256').update(rawBody).digest('hex')};
  }
  public async settle(input:SettlementRequest):Promise<SettlementResult>{
    if(!input.subMchid||!input.transactionId)throw new BusinessError('VALIDATION_ERROR','分账缺少微信支付子单信息',409);
    if(input.commissionCents===0){const response=await this.request<{order_id?:string}>('POST','/v3/ecommerce/profitsharing/finish-order',{sub_mchid:input.subMchid,transaction_id:input.transactionId,out_order_no:input.outOrderNo,description:'订单履约完成，解冻商户资金'});return{providerOrderId:response.order_id??null,status:'PROCESSING'};}
    const receiverName=publicEncrypt({key:this.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from(this.config.platformName)).toString('base64');
    const response=await this.request<{order_id?:string;status?:string;receivers?:Array<{result?:string}>}>('POST','/v3/ecommerce/profitsharing/orders',{appid:this.config.appId,sub_mchid:input.subMchid,transaction_id:input.transactionId,out_order_no:input.outOrderNo,receivers:[{type:'MERCHANT_ID',receiver_account:this.config.spMchid,amount:input.commissionCents,description:'平台运营服务佣金',receiver_name:receiverName}],finish:true});
    return{providerOrderId:response.order_id??null,status:this.settlementStatus(response.status,response.receivers)};
  }
  public async querySettlement(input:SettlementRequest):Promise<SettlementResult>{
    if(!input.subMchid||!input.transactionId)throw new BusinessError('VALIDATION_ERROR','分账查询缺少微信支付子单信息',409);
    const query=new URLSearchParams({sub_mchid:input.subMchid,transaction_id:input.transactionId,out_order_no:input.outOrderNo});
    const response=await this.request<{order_id?:string;status?:string;receivers?:Array<{result?:string}>}>('GET',`/v3/ecommerce/profitsharing/orders?${query}`,undefined);
    return{providerOrderId:response.order_id??null,status:this.settlementStatus(response.status,response.receivers)};
  }

  private async request<T>(method:string,path:string,payload:unknown,mchid=this.config.spMchid,usePlatformCredential=false):Promise<T>{
    const body=payload===undefined?'':JSON.stringify(payload);
    const timestamp=String(Math.floor(Date.now()/1000));const nonce=randomBytes(16).toString('hex');
    const signature=this.sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`,usePlatformCredential?this.platformPrivateKey:this.privateKey);
    const certificateSerial=usePlatformCredential?(this.config.platformCertificateSerial??this.config.certificateSerial):this.config.certificateSerial;
    const authorization=`WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${certificateSerial}"`;
    const response=await fetch(`https://api.mch.weixin.qq.com${path}`,{method,...(body?{body}:{}),headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'hometown-food-platform/1.0',Authorization:authorization,'Wechatpay-Serial':this.config.publicKeyId},signal:AbortSignal.timeout(8_000)});
    const raw=await response.text();
    this.verifyMessage(raw,{
      'wechatpay-timestamp':response.headers.get('wechatpay-timestamp')??undefined,
      'wechatpay-nonce':response.headers.get('wechatpay-nonce')??undefined,
      'wechatpay-signature':response.headers.get('wechatpay-signature')??undefined,
      'wechatpay-serial':response.headers.get('wechatpay-serial')??undefined,
    });
    if(!response.ok){const error=JSON.parse(raw) as {code?:string;message?:string};throw new BusinessError('EXTERNAL_SERVICE_ERROR',error.message??'微信支付服务暂时不可用',502,{providerCode:error.code});}
    return JSON.parse(raw) as T;
  }

  private sign(message:string,privateKey=this.privateKey):string{return sign('RSA-SHA256',Buffer.from(message),privateKey).toString('base64');}
  private verifyMessage(rawBody:string,headers:Record<string,string|undefined>):void{
    const timestamp=headers['wechatpay-timestamp'];const nonce=headers['wechatpay-nonce'];const signature=headers['wechatpay-signature'];const serial=headers['wechatpay-serial'];
    if(!timestamp||!nonce||!signature||serial!==this.config.publicKeyId||signature.startsWith('WECHATPAY/SIGNTEST/'))throw new BusinessError('FORBIDDEN','微信支付签名无效',401);
    if(Math.abs(Date.now()/1000-Number(timestamp))>300)throw new BusinessError('FORBIDDEN','微信支付通知已过期',401);
    const valid=verify('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`),this.publicKey,Buffer.from(signature,'base64'));
    if(!valid)throw new BusinessError('FORBIDDEN','微信支付签名无效',401);
  }
  private decrypt(resource:WechatEncryptedResource):unknown{
    if(resource.algorithm!=='AEAD_AES_256_GCM')throw new BusinessError('VALIDATION_ERROR','不支持的微信支付回调加密算法',400);
    const encrypted=Buffer.from(resource.ciphertext,'base64');const tag=encrypted.subarray(encrypted.length-16);const ciphertext=encrypted.subarray(0,-16);
    const decipher=createDecipheriv('aes-256-gcm',Buffer.from(this.config.apiV3Key),Buffer.from(resource.nonce));
    decipher.setAuthTag(tag);decipher.setAAD(Buffer.from(resource.associated_data??''));
    return JSON.parse(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8')) as unknown;
  }
  private refundStatus(status:string|undefined):RefundResult['status']{if(status==='SUCCESS')return'SUCCEEDED';if(status==='PROCESSING')return'PROCESSING';return'FAILED';}
  private settlementStatus(status:string|undefined,receivers:Array<{result?:string}>|undefined):SettlementResult['status']{if(status==='FINISHED'&&(!receivers||receivers.every((item)=>item.result==='SUCCESS')))return'SUCCEEDED';if(status==='PROCESSING'||receivers?.some((item)=>item.result==='PENDING'))return'PROCESSING';return'FAILED';}
}
