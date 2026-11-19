import {DEPOSITION as D,IMPLANT as I,PATTERN_ETCH as E} from '../constants.js';
function range(v,min,max,label){if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${label}: ${min}~${max} 범위를 확인하세요.`);}
export function filmStats(values){
  const meanNm=values.reduce((a,b)=>a+b,0)/values.length,minNm=Math.min(...values),maxNm=Math.max(...values);
  return {meanNm,minNm,maxNm,nonuniformity:meanNm>0?(maxNm-minNm)/(2*meanNm):0};
}
export function depositFilm(material,input,existingValues=null,targetNm=D[material]?.targetNm){
  const c=D[material];if(!c)throw new Error('지원하지 않는 증착 재료입니다.');
  range(input.minutes,.1,120,'증착 시간');let rate,u;
  if(material==='metal'){
    range(input.powerW,50,500,'스퍼터 파워');if(!['on','off'].includes(input.rotation))throw new Error('기판 회전을 선택하세요.');
    rate=c.rateNmPerMin*input.powerW/c.referencePowerW;
    u=(input.rotation==='on'?c.rotatingNonuniformity:c.staticNonuniformity)+Math.abs(input.powerW-c.referencePowerW)*c.powerPenalty;
  }else{
    range(input.temperatureC,material==='poly'?580:350,material==='poly'?650:450,'증착 온도');range(input.zoneSpreadC,0,15,'온도 편차');
    const T=input.temperatureC+D.kelvinOffset,Tref=c.referenceC+D.kelvinOffset;
    rate=c.rateNmPerMin*Math.exp(-c.activationEv/D.boltzmannEv*(1/T-1/Tref));
    const sensitivity=c.activationEv/(D.boltzmannEv*T*T);
    u=c.baseNonuniformity+sensitivity*input.zoneSpreadC/2+Math.abs(input.temperatureC-c.referenceC)*c.temperaturePenalty;
  }
  u=Math.min(u,.45);
  const values=D.sampleOffsets.map((offset,index)=>(existingValues?.[index]??0)+rate*input.minutes*(1+offset*u));
  range(targetNm,1,1e6,'목표 두께');
  const stats=filmStats(values),pass=Math.abs(stats.meanNm-targetNm)/targetNm<=D.thicknessTolerance&&stats.nonuniformity<=c.maxNonuniformity;
  return {kind:'deposition',material,rateNmPerMinute:rate,minutes:input.minutes,addedMeanNm:rate*input.minutes,
    values,sites:values.map((thicknessNm,index)=>({name:D.sampleNames[index],thicknessNm})),...stats,
    targetNm,uniformityLimit:c.maxNonuniformity,pass};
}
function interpolate(energy){
  const t=I.table;range(energy,t[0].energy,t.at(-1).energy,'주입 에너지');
  const index=t.findIndex(r=>r.energy>=energy),a=t[Math.max(0,index-1)],b=t[index],f=a===b?0:(energy-a.energy)/(b.energy-a.energy);
  return Object.fromEntries(['rp','straggle','oxideRp'].map(k=>[k,a[k]+f*(b[k]-a[k])]));
}
export function implantPhosphorus({energyKeV,doseCm2},screenOxideNm,polyMinNm){
  range(doseCm2,1e13,5e15,'도즈');const p=interpolate(energyKeV);
  const transmission=Math.exp(-screenOxideNm/p.oxideRp),effectiveDoseCm2=doseCm2*transmission;
  return {kind:'implant',energyKeV,doseCm2,effectiveDoseCm2,transmission,rpNm:p.rp,straggleNm:p.straggle,
    screenOxideNm,gateMaskPass:polyMinNm>=I.minGatePolyNm,pass:transmission>.5&&polyMinNm>=I.minGatePolyNm};
}
export function annealImplant(implant,{temperatureC,seconds}){
  if(!implant)throw new Error('S/D 이온주입을 먼저 실행하세요.');range(temperatureC,900,1100,'어닐링 온도');range(seconds,5,120,'어닐링 시간');
  const diffusionCm2PerSecond=I.diffusionPrefactor*Math.exp(-I.diffusionKelvin/(temperatureC+I.kelvinOffset));
  const sigmaNm=Math.sqrt(implant.straggleNm**2+2*diffusionCm2PerSecond*seconds*I.nmPerCm**2);
  const activation=1-Math.exp(Math.log(1-I.activationAtReference)*(seconds/I.referenceSeconds)*Math.exp((temperatureC-I.referenceAnnealC)/I.activationTempScaleC));
  const activeDoseCm2=implant.effectiveDoseCm2*activation;
  const peakCm3=activeDoseCm2/(Math.sqrt(2*Math.PI)*sigmaNm/I.nmPerCm);
  const junctionNm=peakCm3>I.backgroundCm3?implant.rpNm+sigmaNm*Math.sqrt(2*Math.log(peakCm3/I.backgroundCm3)):0;
  const sheetOhm=activeDoseCm2>0?1/(I.chargeC*I.mobilityCm2Vs*activeDoseCm2):Number.MAX_VALUE;
  const profile=Array.from({length:31},(_,i)=>{const depthNm=i*Math.max(300,junctionNm*1.3)/30;return {depthNm,concentrationCm3:peakCm3*Math.exp(-.5*((depthNm-implant.rpNm)/sigmaNm)**2)};});
  return {kind:'anneal',sigmaNm,activation,activeDoseCm2,peakCm3,junctionNm,sheetOhm,diffusionCm2PerSecond,profile,
    pass:implant.gateMaskPass&&activation>=I.minActivation&&junctionNm>=I.minJunctionNm&&junctionNm<=I.maxJunctionNm&&sheetOhm<=I.maxSheetOhm};
}
export function etchPattern(material,input,geometry,photo,previous=null){
  const c=E[material];if(!c)throw new Error('지원하지 않는 식각 재료입니다.');range(input.minutes,.01,20,'식각 시간');
  const dev=photo.developed,prRate=c.rate/c.prSelectivity;
  const oldOpening=previous?.openingPrNm??dev.openingPrNm,oldProtected=previous?.protectedPrNm??dev.protectedPrNm;
  const duration=Math.max(0,input.minutes-oldOpening/prRate),fieldDuration=Math.max(0,input.minutes-oldProtected/prRate);
  const openValues=geometry.openValues.map(v=>Math.max(0,v-c.rate*duration));
  const protectedValues=geometry.protectedValues.map(v=>Math.max(0,v-c.rate*fieldDuration));
  const addedUnderLoss=geometry.openValues.map(v=>Math.max(0,duration-v/c.rate)*c.rate/c.underSelectivity);
  const underLossValues=addedUnderLoss.map((v,i)=>v+(previous?.underLossValues?.[i]??0));
  const defectValues=geometry.defectValues.map(v=>Math.max(0,v-c.rate*input.minutes));
  const referenceMax=photo.referenceFilmMaxNm,totalMinutes=(previous?.totalMinutes??0)+input.minutes;
  const overetchFraction=Math.max(0,totalMinutes/(referenceMax/c.rate)-1),maxResidualNm=Math.max(...openValues);
  const status=maxResidualNm>E.residualToleranceNm?'미식각':overetchFraction>E.maxOveretchFraction?'과식각':'정상';
  const protectedStats=filmStats(protectedValues),maxUnderlyingLossNm=Math.max(...underLossValues);
  const pass=status==='정상'&&protectedStats.minNm>=photo.referenceFilmMinNm*E.minProtectedFraction&&maxUnderlyingLossNm<=E.maxUnderlyingLossNm&&dev.defectFraction<=E.maxDefectFraction&&photo.alignment.alignmentPass;
  return {kind:'pattern-etch',material,openValues,protectedValues,defectValues,underLossValues,
    maxResidualNm,protectedMeanNm:protectedStats.meanNm,protectedMinNm:protectedStats.minNm,maxUnderlyingLossNm,
    defectFraction:dev.defectFraction,overlayUm:photo.alignment.overlayUm,overetchFraction,totalMinutes,
    lateralLossNm:totalMinutes*c.rate*c.lateralFactor,status,openingPrNm:Math.max(0,oldOpening-prRate*input.minutes),protectedPrNm:Math.max(0,oldProtected-prRate*input.minutes),pass};
}
