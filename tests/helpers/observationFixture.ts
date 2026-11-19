import { emptyWorking, complexKeyOf } from '../../shared/model.ts';
export function fixture() {
  const w=emptyWorking('가상 시험', '2026-11-01'); w.property.exclusiveAreaM2=84;w.options.minSample=3;
  w.events=[{key:'ev',name:'가상 사건',category:'transport',direction:'unknown',dataMode:'demo',evidenceKeys:[],milestones:[{key:'ms',type:'opening',status:'actual',date:'2025-07-15',evidenceKeys:[]}]}];
  for(const name of ['A','B']) for(const period of ['pre','post']) for(let i=0;i<3;i++) w.transactions.push({key:`${name}-${period}-${i}`,complexName:name,exclusiveAreaM2:84,priceKrw:84*1000000*(period==='pre'?1:name==='A'?1.2:1.1),contractDate:period==='pre'?`2025-06-${10+i}`:`2025-08-${10+i}`,cancelled:false,dataMode:'demo',floor:i});
  w.observation={eventKey:'ev',milestoneKey:'ms',months:6,impact:[complexKeyOf(w.transactions[0])],control:[complexKeyOf(w.transactions[6])]};return w;
}
