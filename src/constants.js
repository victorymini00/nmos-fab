// Scene units are arbitrary training-space units, not process or physical constants.
export const WORLD = Object.freeze({ speed: 4.3, playerHalfSize: 0.32, interactionRange: 1.65, maxDelta: 0.04, cameraSpan: 19, pixelRatioCap: 1.5 });

// Source: University of Illinois ECE444, GT8 (Grove model coefficients).
// https://fabweb.ece.illinois.edu/gt/gt/gt8.aspx
// B=C1 exp(-b1/T) [cm²/s], B/A=C2 exp(-b2/T) [cm/s]. T in K.
// Source coefficients refer to Si(111); divide C2 by 1.68 for Si(100).
// 'wet' uses the source's Wet row, not its distinct Steam row.
// Reference atmosphere only: pressure is not an input or a calibrated furnace recipe.
export const OXIDATION = Object.freeze({
  coefficients: {
    dry: { C1:2.144e-9, C2:.173, b1:14270, b2:23200 },
    wet: { C1:5.940e-10, C2:2.490, b1:8237, b2:23200 }
  },
  orientationFactor:1.68, kelvinOffset:273.15,
  cmToUm:1e4, secondsPerHour:3600, nmPerUm:1000, minutesPerHour:60,
  minTemperatureC:920, maxTemperatureC:1100, maxTimeMinutes:240,
  // Teaching assumptions, not measured RCA outcomes or tool resolution. 검증 필요.
  initialOxideNm:2, measurementDecimals:1,
  // Empirical limitation: Deal-Grove misses enhanced initial dry growth below ~30nm.
  // https://iue.tuwien.ac.at/phd/hollauer/node16.html section 2.6.6
  thinDryLimitNm:30
});
export const STORAGE = Object.freeze({key:'nmos-fab-stage-2-v1',version:1});

// Spin trend: h ~ rpm^-1/2, MicroChemicals spin coating application note.
// https://www.microchemicals.com/dokumente/application_notes/spin_coating_photoresist.pdf
// HMDS/positive PR process trends: EPFL CMi photolithography introduction.
// https://www.epfl.ch/research/facilities/cmi/process/photolithography/introductiontophotolithography/
// All numerical PHOTO values below are approved teaching calibration, NOT product specifications.
// 검증 필요: nominal thickness/dose/develop rates, adhesion-loss fractions, overlay tolerances.
export const PHOTO=Object.freeze({
  referenceRpm:3000,referencePrNm:1500,spinExponent:.5,
  referenceDose:100,referenceDevelopSeconds:60,
  exposedRateNmPerSecond:25,darkRateNmPerSecond:.5,maxDoseFactor:3,
  hmdsAdhesion:1,skippedAdhesion:.55,developmentLossScale:.4,
  maskWidthUm:20,maskHeightUm:12,alignmentLeverArmUm:40,alignmentToleranceUm:1,
  initialAlignment:{offsetXUm:3.5,offsetYUm:-2.5,rotationDeg:1},
  maxOffsetUm:8,maxRotationDeg:5,alignmentStepUm:.25,rotationStepDeg:.1,
  softBakeC:100,softBakeSeconds:60,reworkPenalty:5,
  minRpm:1000,maxRpm:6000,minDose:10,maxDose:300,minDevelop:5,maxDevelop:180,
  patternScumToleranceNm:5,minProtectionNm:500
});
// BOE 6:1, room temperature ~80 nm/min: Georgia Tech educational recipe.
// https://sums.gatech.edu/articles/ProEtch (Spring 2020 table).
// Actual rate depends on bath, temperature and oxide; tool calibration 검증 필요.
// Selectivity/overetch tolerances are teaching assumptions, not measured BOE/PR data.
export const ETCH=Object.freeze({oxideRateNmPerMinute:80,oxideToPrSelectivity:20,
  overetchFraction:.1,maxOveretchFraction:.2,oxideResidualToleranceNm:5,
  defectAreaTolerance:.05,maxMinutes:20});

// LPCVD trend/reference: DTU POLY620 ~10-12 nm/min, wafer nonuniformity <2%.
// https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Thin_film_deposition/Furnace_LPCVD_PolySilicon/Standard_recipes,_QC_limits_and_results_for_the_4%22_polysilicon_furnace
// Sputter spatial mapping/rotation concept: https://uhnf.egr.uh.edu/pythography/sputtering-guide/sputtering-uniformity/
// Approved teaching calibrations, 검증 필요: activation energy, T spread, Al power-rate slope,
// uniformity coefficients, LTO rate and all pass limits. Not a measured recipe for these virtual tools.
export const DEPOSITION=Object.freeze({
  boltzmannEv:8.617333262e-5,kelvinOffset:273.15,
  sampleNames:['중앙','북','동','남','서'],sampleOffsets:[0,-1,-.5,.5,1],
  poly:{referenceC:620,rateNmPerMin:10,activationEv:1.5,baseNonuniformity:.01,temperaturePenalty:.0005,targetNm:200,maxNonuniformity:.05},
  ild:{referenceC:400,rateNmPerMin:50,activationEv:.5,baseNonuniformity:.03,temperaturePenalty:.0001,targetNm:500,maxNonuniformity:.06},
  metal:{referencePowerW:200,rateNmPerMin:100,rotatingNonuniformity:.04,staticNonuniformity:.12,powerPenalty:.0001,targetNm:500,maxNonuniformity:.06},
  thicknessTolerance:.1
});
// P in Si and SiO2 range/straggle in nm. Source table originally µm, converted ×1000.
// https://fabweb.ece.illinois.edu/gt/gt/gt15.aspx (10,20,50,100keV rows; linear interpolation).
// Diffusion D=10.5 exp(-42800/T) cm²/s: https://fabweb.ece.illinois.edu/gt/gt/gt10.aspx
// 검증 필요: activation kinetics, constant mobility/background, oxide transmission approximation,
// and quality bounds below. Gaussian without channeling/TED/solid-solubility corrections.
export const IMPLANT=Object.freeze({
  table:[{energy:10,rp:13.9,straggle:6.9,oxideRp:10.8},{energy:20,rp:25.3,straggle:11.9,oxideRp:19.9},{energy:50,rp:60.7,straggle:25.6,oxideRp:48.6},{energy:100,rp:123.8,straggle:45.6,oxideRp:100.2}],
  diffusionPrefactor:10.5,diffusionKelvin:42800,nmPerCm:1e7,kelvinOffset:273.15,
  referenceAnnealC:1000,referenceSeconds:30,activationAtReference:.9,activationTempScaleC:70,
  chargeC:1.602176634e-19,mobilityCm2Vs:100,backgroundCm3:1e16,
  minActivation:.7,minJunctionNm:70,maxJunctionNm:400,maxSheetOhm:300,
  gateNominalLengthUm:10,minGatePolyNm:100
});
// Patterned dry/wet etch teaching models, all rates/selectivities/tolerances 검증 필요.
// Selectivity: target material rate / underlying material rate, likewise for PR.
export const PATTERN_ETCH=Object.freeze({
  poly:{rate:100,prSelectivity:3,underSelectivity:30,lateralFactor:.05},
  ild:{rate:100,prSelectivity:4,underSelectivity:20,lateralFactor:.08},
  metal:{rate:300,prSelectivity:5,underSelectivity:50,lateralFactor:1},
  overetchFraction:.1,maxOveretchFraction:.25,residualToleranceNm:5,
  minProtectedFraction:.8,maxDefectFraction:.05,maxUnderlyingLossNm:10
});

// Long-channel MOS electrostatics and square law:
// https://iic-jku.github.io/design-complex-ic/slides/mosfet.html
// https://dunham.ece.uw.edu/ee531/Long_Channel_MOSFET.pdf
// Units: cm, F/cm, cm^-3, cm²/Vs. q and k are SI exact definitions; eps0 converted to F/cm.
// 검증 필요: effective Vfb=0V (not a calibrated n+ poly work function), fixed channel mobility,
// access/contact geometry, contact resistance, defect cutoffs and grading weights.
// S/D doping affects series resistance, NOT the p-substrate doping in the Vt equation.
export const ELECTRICAL=Object.freeze({
  q:1.602176634e-19,k:1.380649e-23,eps0FPerCm:8.8541878128e-14,
  siliconRelativePermittivity:11.7,oxideRelativePermittivity:3.9,
  intrinsicCm3:1e10,flatBandV:0,channelMobility:400,nmPerCm:1e7,
  nominalWidthUm:20,nominalLengthUm:10,accessLengthUm:5,
  contactOhmPerTerminal:100,alResistivityOhmCm:2.65e-6,wireLengthUm:100,wireWidthUm:10,
  minOxideNm:2,minPolyNm:100,minMetalNm:100,maxResidualNm:5,maxDefectFraction:.05,
  minChannelLengthUm:1,alignmentOpenUm:5,solverIterations:60,
  vtWeight:25,ionWeight:30,uniformityWeight:10,failedInspectionWeight:3,failedInspectionCap:15,
  reworkPenaltyCap:20,feedbackVtScale:.15,feedbackIonScale:.2
});

// 6단계 3D 비주얼 설정. 교육용 표시값이며 물리 모델과 무관합니다.
export const VISUALS = Object.freeze({
  // 장비 신호등 점멸 주기 [Hz]와 실행 직후 강조 시간 [s]
  runningBlinkHz: 1.6, faultBlinkHz: 2.4, pulseBlinkHz: 6, pulseSeconds: 2.6,
  // 안내 화살표: 장비 위 높이 [m], 상하 진폭 [m], 발밑 화살표를 숨기는 거리 [m]
  arrowLift: 2.5, arrowBob: .25, chevronHideDistance: 2.6,
  // 성능 감시: 시작 후 warmup 동안 무시, 평균 프레임 시간이 limit를 hold 동안 넘으면 단순화
  perfWarmupSeconds: 2.5, perfFrameLimitSeconds: 1/32, perfHoldSeconds: 2, perfSmoothing: .1,
  // 패널이 열려 있으면 N프레임마다 한 번만 렌더링
  pausedRenderEvery: 6
});
