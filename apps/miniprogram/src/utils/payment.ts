import { api } from './api';

function requestWechatPayment(payload:Record<string,string>):Promise<void>{
  const {timeStamp,nonceStr,paySign}=payload;const packageValue=payload.package;
  if(!timeStamp||!nonceStr||!packageValue||!paySign)return Promise.reject(new Error('支付参数不完整'));
  return new Promise((resolve,reject)=>wx.requestPayment({timeStamp,nonceStr,package:packageValue,signType:'RSA',paySign,success:()=>resolve(),fail:(error)=>reject(new Error(error.errMsg||'支付未完成'))}));
}

export async function payOrder(orderId:string):Promise<'mock'|'wechat-platform'>{
  const payment=await api.initiatePayment(orderId);
  if(payment.provider==='mock')await api.mockPay(orderId);else await requestWechatPayment(payment.clientPayload);
  return payment.provider;
}
