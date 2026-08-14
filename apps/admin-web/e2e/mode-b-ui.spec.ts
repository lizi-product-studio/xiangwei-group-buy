import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type ApiEnvelope<T> = { data: T };
const superAdmin={'x-demo-user-id':'demo-super-admin','x-demo-role':'SUPER_ADMIN'};

async function call<T>(request: APIRequestContext, path: string, method: 'GET' | 'POST', data?: unknown, headers: Record<string,string> = superAdmin): Promise<T> {
  const response=await request.fetch(`http://127.0.0.1:3100${path}`,{method,headers:{...headers,...(data===undefined?{}:{'content-type':'application/json'})},data});
  expect(response.status(),`${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return (await response.json() as ApiEnvelope<T>).data;
}

async function chooseFirst(page:Page,label:string){const control=page.getByLabel(label,{exact:true});await control.click();await control.press('ArrowDown');await control.press('Enter');}

test('社区团购的发车、点位差异到货和部分领取由后台界面完成',async({page,request})=>{
  const suffix=`community-ui-${Date.now()}`;
  // Fixture setup is API-only. Daily operations below stay browser-driven.
  const area=await call<{id:string}>(request,'/api/v1/admin/service-areas','POST',{regionCode:'130606'});
  const point=await call<{id:string}>(request,'/api/v1/admin/pickup-points','POST',{serviceAreaId:area.id,name:`E2E 社区点 ${suffix}`,address:`保定市莲池区 E2E 路 ${suffix}`,capacityPerDay:100});
  const sku=await call<{id:string}>(request,'/api/v1/admin/platform/skus','POST',{title:`E2E 社区干货 ${suffix}`,category:'干货',origin:'河北',imageUrl:null,skuName:'500g',retailPriceCents:1200,defaultSellableQuantity:10,referencePurchaseCostCents:null,supplierNote:null,status:'ACTIVE'});
  const campaign=await call<{id:string}>(request,'/api/v1/admin/community/campaigns','POST',{title:`E2E 社区团 ${suffix}`,serviceAreaId:area.id,pickupPointId:point.id,cutoffAt:new Date(Date.now()+1_100).toISOString(),dispatchAt:new Date(Date.now()+86_400_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:sku.id,retailPriceCents:1200,sellableQuantity:3}]});
  await call(request,`/api/v1/admin/campaigns/${campaign.id}/open`,'POST');
  const order=await call<{id:string;orderNo:string}>(request,'/api/v1/orders','POST',{campaignId:campaign.id,serviceAreaId:area.id,pickupPointId:point.id,items:[{skuId:sku.id,quantity:3}]},{...superAdmin,'idempotency-key':`community-ui-order-${suffix}`});
  await call(request,`/api/v1/orders/${order.id}/mock-pay`,'POST');
  await page.waitForTimeout(1_250);
  await call(request,`/api/v1/admin/campaigns/${campaign.id}/close`,'POST');

  await page.goto('/');
  await page.getByText('配送与领取',{exact:true}).click();
  await expect(page.getByRole('heading',{name:'配送与领取'})).toBeVisible();
  await expect(page.getByText('轻量履约主线')).toBeVisible();
  await expect(page.getByRole('button',{name:'新增平台商品'})).toBeVisible();

  const deliveryRow=page.getByRole('row',{name:new RegExp(`${suffix}.*录入运单`)});
  await deliveryRow.getByRole('button',{name:'录入运单'}).click();
  await page.getByLabel('配送平台').fill('货拉拉');
  await page.getByLabel('运单号 / 约车凭证').fill(`HL-${suffix}`);
  await page.getByLabel('司机姓名').fill('E2E 司机');
  await page.getByLabel('司机电话').fill('13900000000');
  await page.getByLabel('车牌号').fill('冀F12345');
  await page.getByRole('button',{name:'保存运单并确认预约'}).click();
  const campaignRow=page.getByRole('row',{name:new RegExp(`${suffix}.*创建配送批次`)});
  await expect(campaignRow.getByRole('button',{name:'创建配送批次'})).toBeVisible();
  await campaignRow.getByRole('button',{name:'创建配送批次'}).click();
  await page.getByRole('row',{name:new RegExp(`${suffix}.*确认发车`)}).getByRole('button',{name:'确认发车'}).click();
  const arrivalRow=page.getByRole('row',{name:new RegExp(`${suffix}.*逐商品确认到货`)});
  await expect(arrivalRow.getByRole('button',{name:'逐商品确认到货'})).toBeVisible();

  await arrivalRow.getByRole('button',{name:'逐商品确认到货'}).click();
  await page.getByLabel('接货人').fill('E2E 点位负责人');
  await page.getByLabel('实到').fill('2');
  await page.getByLabel('短少').fill('1');
  await chooseFirst(page,'差异原因（有差异时必填）');
  await page.getByLabel('文字证据（有差异时必填）').fill('现场清点短少一件');
  await page.getByRole('button',{name:'确认到货与差异'}).click();
  await expect(page.getByText(order.orderNo)).toBeVisible();
  await expect(page.getByText(/异常 1 件，已退 0 件，本退 1 件/)).toBeVisible();

  const pickupCode=await call<{code:string}>(request,`/api/v1/pickup-code?orderId=${order.id}`,'GET');
  await page.getByRole('row',{name:new RegExp(`${suffix}.*按提货码确认领取`)}).getByRole('button',{name:'按提货码确认领取'}).click();
  await page.getByLabel('订单号').fill(order.orderNo);
  await page.getByRole('button',{name:'查询订单商品'}).click();
  await expect(page.getByText(/待领 2 \/ 已领 0 \/ 异常 1/)).toBeVisible();
  await page.getByLabel('六码取货码').fill(pickupCode.code);
  await page.getByRole('button',{name:'核验并确认本次领取'}).click();
  await expect(page.getByRole('dialog',{name:'现场核销'})).toBeHidden();
});
