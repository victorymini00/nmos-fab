import { OXIDATION as C } from '../constants.js';
export function oxidationRates(temperatureC,ambient) {
  if(!Number.isFinite(temperatureC)||temperatureC<C.minTemperatureC||temperatureC>C.maxTemperatureC)throw new Error(`온도는 ${C.minTemperatureC}~${C.maxTemperatureC}°C 범위로 입력하세요.`);
  if(!Object.hasOwn(C.coefficients,ambient))throw new Error('분위기는 건식 또는 습식이어야 합니다.');
  const coeff=C.coefficients[ambient];
  const T=temperatureC+C.kelvinOffset;
  const B=coeff.C1*Math.exp(-coeff.b1/T)*C.cmToUm**2*C.secondsPerHour;
  const linear=coeff.C2/C.orientationFactor*Math.exp(-coeff.b2/T)*C.cmToUm*C.secondsPerHour;
  return {A:B/linear,B,linear};
}
export function growOxide({temperatureC,timeMinutes,ambient,initialOxideNm}) {
  if(!Number.isFinite(timeMinutes)||timeMinutes<0||timeMinutes>C.maxTimeMinutes)throw new Error(`시간은 0~${C.maxTimeMinutes}분 범위로 입력하세요.`);
  if(!Number.isFinite(initialOxideNm)||initialOxideNm<0)throw new Error('초기 두께가 올바르지 않습니다.');
  const {A,B,linear}=oxidationRates(temperatureC,ambient),xi=initialOxideNm/C.nmPerUm;
  const q=xi*xi+A*xi+B*timeMinutes/C.minutesPerHour;
  // Stable positive root of x²+Ax=xi²+Axi+Bt (avoids subtractive cancellation).
  const thicknessNm=2*q/(Math.sqrt(A*A+4*q)+A)*C.nmPerUm;
  return {thicknessNm,Aum:A,Bum2PerHour:B,linearUmPerHour:linear,initialOxideNm,
    warning:ambient==='dry'&&initialOxideNm<C.thinDryLimitNm?'검증 필요: 초기 30 nm 이하 건식 산화의 빠른 성장 보정은 생략했습니다.':null};
}
