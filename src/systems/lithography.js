import {PHOTO as P,ETCH as E} from '../constants.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function range(x,a,b,name){if(!Number.isFinite(x)||x<a||x>b)throw new Error(`${name}: ${a}~${b} 범위를 입력하세요.`);}
export function coatResist(rpm){range(rpm,P.minRpm,P.maxRpm,'회전수');return P.referencePrNm*(P.referenceRpm/rpm)**P.spinExponent;}
export function alignmentResult({offsetXUm,offsetYUm,rotationDeg}){
  range(offsetXUm,-P.maxOffsetUm,P.maxOffsetUm,'X 정렬');range(offsetYUm,-P.maxOffsetUm,P.maxOffsetUm,'Y 정렬');range(rotationDeg,-P.maxRotationDeg,P.maxRotationDeg,'회전');
  const overlayUm=Math.hypot(offsetXUm,offsetYUm)+P.alignmentLeverArmUm/2*Math.abs(Math.sin(rotationDeg*Math.PI/180));
  return {offsetXUm,offsetYUm,rotationDeg,overlayUm,alignmentPass:overlayUm<=P.alignmentToleranceUm};
}
export function developResist({prNm,dose,seconds,hmds,alignment}){
  range(seconds,P.minDevelop,P.maxDevelop,'현상 시간');range(dose,P.minDose,P.maxDose,'노광량');
  if(!Number.isFinite(prNm)||prNm<=0)throw new Error('PR 코팅이 필요합니다.');
  const doseFactor=clamp(dose/(P.referenceDose*prNm/P.referencePrNm),0,P.maxDoseFactor);
  const openingPrNm=Math.max(0,prNm-P.exposedRateNmPerSecond*doseFactor*seconds);
  const protectedPrNm=Math.max(0,prNm-P.darkRateNmPerSecond*Math.max(1,doseFactor*doseFactor)*seconds);
  const adhesion=hmds?P.hmdsAdhesion:P.skippedAdhesion;
  const defectFraction=clamp((1-adhesion)*P.developmentLossScale*seconds/P.referenceDevelopSeconds,0,1);
  const pass=openingPrNm<=P.patternScumToleranceNm&&protectedPrNm>=P.minProtectionNm&&alignment.alignmentPass&&defectFraction<=E.defectAreaTolerance;
  return {openingPrNm,protectedPrNm,defectFraction,adhesion,overlayUm:alignment.overlayUm,pass};
}
export function etchOxide({activeOxideNm,fieldOxideNm,defectOxideNm,openingPrNm,protectedPrNm,defectFraction,minutes,totalMinutes=0,referenceOxideNm}){
  range(minutes,.01,E.maxMinutes,'BOE 시간');
  const prRate=E.oxideRateNmPerMinute/E.oxideToPrSelectivity;
  const removedNm=E.oxideRateNmPerMinute*Math.max(0,minutes-openingPrNm/prRate);
  const fieldRemovedNm=E.oxideRateNmPerMinute*Math.max(0,minutes-protectedPrNm/prRate);
  const active=Math.max(0,activeOxideNm-removedNm),field=Math.max(0,fieldOxideNm-fieldRemovedNm);
  const defect=defectFraction>0?Math.max(0,defectOxideNm-E.oxideRateNmPerMinute*minutes):defectOxideNm;
  const total=totalMinutes+minutes,clearMinutes=referenceOxideNm/E.oxideRateNmPerMinute;
  const overetchFraction=Math.max(0,(total-clearMinutes)/clearMinutes);
  const status=active>E.oxideResidualToleranceNm?'미식각':overetchFraction>E.maxOveretchFraction?'과식각':'정상';
  return {activeOxideNm:active,fieldOxideNm:field,defectOxideNm:defect,
    openingPrNm:Math.max(0,openingPrNm-prRate*minutes),protectedPrNm:Math.max(0,protectedPrNm-prRate*minutes),
    defectFraction,totalMinutes:total,overetchFraction,undercutNm:E.oxideRateNmPerMinute*total,
    protectedOxideLossNm:Math.max(0,referenceOxideNm-field),status,
    pass:status==='정상'&&field>=referenceOxideNm-E.oxideResidualToleranceNm&&defectFraction<=E.defectAreaTolerance};
}
