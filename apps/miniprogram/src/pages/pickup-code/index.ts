import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';

Page({
  data:{code:'',expiresText:'',loading:true,error:''},
  async onLoad(options:Record<string,string|undefined>){
    if(!options.orderId){this.setData({loading:false,error:'订单参数缺失'});return;}
    try{
      const result=await api.getPickupCode(options.orderId);
      this.setData({code:result.code,expiresText:formatDateTime(result.expiresAt)});
    }catch(error){this.setData({error:error instanceof Error?error.message:'取货码加载失败'});}
    finally{this.setData({loading:false});}
  },
});
