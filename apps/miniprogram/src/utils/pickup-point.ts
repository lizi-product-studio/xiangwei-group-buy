import { api } from './api';

const KEY='selectedPickupPoint';
export type PickupPointSelection=PickupPointDto;

function valid(value:unknown):value is PickupPointSelection{
  if(!value||typeof value!=='object')return false;
  const point=value as Partial<PickupPointSelection>;
  return typeof point.id==='string'&&typeof point.serviceAreaId==='string'&&typeof point.name==='string'&&typeof point.address==='string';
}
export function readPickupPointSelection():PickupPointSelection|null{const value:unknown=wx.getStorageSync(KEY);return valid(value)?value:null;}
export function savePickupPointSelection(point:PickupPointSelection):void{wx.setStorageSync(KEY,point);}
export function clearPickupPointSelection():void{wx.removeStorageSync(KEY);}
export async function loadPickupPoints(serviceAreaId:string):Promise<{points:PickupPointSelection[];selected:PickupPointSelection|null}>{
  const points=await api.listPickupPoints(serviceAreaId);const stored=readPickupPointSelection();const selected=points.find((item)=>item.id===stored?.id)??null;if(stored&&!selected)clearPickupPointSelection();return{points,selected};
}
