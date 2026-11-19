// 프레임 시간 감시. 평균 프레임 시간이 기준을 일정 시간 넘으면 한 번만 degrade를 알립니다.
export function createPerfMonitor({warmup,limit,hold,smoothing}){
  let elapsed=0,average=null,over=0,tripped=false;
  return {
    sample(dt){
      if(tripped)return false;elapsed+=dt;if(elapsed<warmup)return false;
      average=average===null?dt:average+(dt-average)*smoothing;
      over=average>limit?over+dt:0;
      if(over>=hold){tripped=true;return true;}return false;
    },
    get average(){return average;},get tripped(){return tripped;}
  };
}
