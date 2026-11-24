import type { SectionProps } from '../AnalysisView.tsx';
import { CoordField } from './InputSection.tsx';
import { Badge } from '../components.tsx';
import { complexKeyOf, MILESTONE_LABEL } from '../../shared/model.ts';
import { labelOfComplexKey, validObservationLocation, observationOptions, observeGroups, type ObservationOptions, type ObservationResult } from '../../shared/observation.ts';
import { latestRun } from '../../shared/runs.ts';
import { fmtExclusivePyeong, fmtMan, fmtPct, fmtPp } from '../../shared/units.ts';
import { stableStringify } from '../../shared/hash.ts';

const GROUP_LABEL = { impact: '영향권', control: '비교군' } as const;
export function ObservationPanel({rec, update, children}: Pick<SectionProps,'rec'|'update'> & {children?: any}) {
  const w=rec.working, o=observationOptions(w), r=observeGroups(w);
  const { run, result: runResult, stale } = latestRun(rec);
  const runObs = runResult?.groupObservation;
  const change=(fn:(x:ObservationOptions)=>void)=>update(x=>{x.observation=observationOptions(x);fn(x.observation);});
  const complexes=[...new Map(w.transactions.map(t=>[complexKeyOf(t),t])).keys()].map(k=>({key:k,label:labelOfComplexKey(k,w.transactions),missing:false}));
  const missingRows=[...new Set(r.missingSelections.map(m=>m.key))].map(k=>({key:k,label:labelOfComplexKey(k),missing:true}));
  const ev=w.events.find(e=>e.key===o.eventKey);
  const configured = !!(o.eventKey || o.impact.length || o.control.length);
  const status = !configured ? null
    : !run ? { tone: 'warn', text: '아직 분석 실행 기록이 없습니다 — ‘분석 다시 실행’ 후 보고서에 포함됩니다.' }
    : !runObs ? { tone: 'warn', text: `마지막 분석 실행(#${run.runNo})에는 그룹 관측이 없습니다 — 보고서에 넣으려면 ‘분석 다시 실행’을 누르십시오.` }
    : stableStringify(runObs) !== stableStringify(r) ? { tone: 'bad', text: `아래 값은 현재 작업본 기준이며 마지막 분석 실행(#${run.runNo}) 결과와 다릅니다. 보고서에는 실행 #${run.runNo} 값이 들어갑니다 — ‘분석 다시 실행’으로 반영하십시오.` }
    : stale ? { tone: 'warn', text: `그룹 관측 값은 마지막 분석 실행(#${run.runNo})과 같지만 다른 입력이 바뀌었습니다 — 보고서 전체를 현재 입력으로 맞추려면 ‘분석 다시 실행’을 누르십시오.` }
    : { tone: 'ok', text: `마지막 분석 실행(#${run.runNo})과 같은 값입니다 — 보고서에 이 값이 들어갑니다.` };
  return <div data-testid="observation-panel">
    <h4>수동 확인 영향권·비교군 관측 <Badge tone="info">현재 작업본 기준 · 즉시 갱신</Badge> <span className="muted small">영향권 반경 {w.options.radiusM}m · 좌표 확인 단지만 사용</span></h4>
    <p className="small">사건과 비교 기준일을 고른 뒤, 거래를 조회하고 영향권 단지를 선택하세요. 같은 기간을 비교할 대조 단지가 있으면 비교군에 표시하세요.</p>
    {status && <div className={`banner ${status.tone} small`} data-testid="obs-run-status">{status.text}</div>}
    <div className="toolbar">
      <label>사건 <select data-testid="obs-event" value={o.eventKey??''} onChange={(e: any)=>change(x=>{x.eventKey=e.target.value||undefined;x.milestoneKey=undefined;})}><option value="">선택</option>{w.events.map(e=><option key={e.key} value={e.key}>{e.name}</option>)}</select></label>
      <label>비교 기준일 <select data-testid="obs-basis-choice" value={o.anchorBasis ?? 'actual'} onChange={(e:any)=>change(x=>{x.anchorBasis=e.target.value;})}><option value="actual">실제 발생일</option><option value="known">처음 알려진 날</option></select></label>
      <label>실제 기록 일정 <select data-testid="obs-milestone" value={o.milestoneKey??''} onChange={(e: any)=>change(x=>{x.milestoneKey=e.target.value||undefined;})}><option value="">선택</option>{ev?.milestones.filter(m=>m.status==='actual'&&m.date).map(m=><option key={m.key} value={m.key}>{MILESTONE_LABEL[m.type]} · {m.date}</option>)}</select></label>
      <label>전후 기간 <select data-testid="obs-months" value={o.months} onChange={(e: any)=>change(x=>{x.months=Number(e.target.value) as 3|6|12;})}>{[3,6,12].map(n=><option key={n} value={n}>{n}개월</option>)}</select></label>
    </div>
    <p className="small">사건 최초 공개 {r.basis.firstKnown || '미확인'} · 선택 일정 실제 발생 {r.basis.actualDate || '미선택'} · 비교 기준 {r.anchorLabel || '미선택'} {r.anchor}</p>
    {children}
    <p className="obs-selection small" data-testid="obs-selection">선택 중: {(['impact','control'] as const).map(g=>{ const ks=o[g]; const n=w.transactions.filter(t=>ks.includes(complexKeyOf(t))).length; return <span key={g} className="sel-pill">{GROUP_LABEL[g]} {ks.length}곳 · 거래 {n}건</span>; })}{r.overlap.length>0 && <span className="sel-pill warn">중복 {r.overlap.length}곳(양쪽 제외)</span>}{r.missingSelections.length>0 && <span className="sel-pill warn">현재 거래 없음 {r.missingSelections.length}곳</span>}{!r.overlap.length && !r.missingSelections.length && <span className="sel-pill ok">중복 없음</span>}</p>
    <p className="small">기준 {r.anchor||'미선택'} · 전 [{r.start||'—'}, 기준일) / 후 [기준일, {r.end||'—'}) · 기준일 당일은 후에 포함. 전용면적은 기본 입력, 허용범위·최소 표본은 기존 분석 옵션을 사용합니다.</p>
    <div className="table-scroll"><table className="tbl small" data-testid="obs-groups"><thead><tr><th>단지</th><th>수동 확인 영향권</th><th>수동 확인 비교군</th><th>좌표</th></tr></thead><tbody>
      {[...complexes, ...missingRows].map(({key:k,label,missing})=><tr key={k} data-missing={missing?'1':undefined}>
        <td className="name-cell">{label.name}{missing && <> <Badge tone="bad">현재 거래 없음</Badge></>}<div className="muted">{label.detail}</div>
          {missing && (()=>{ const sim=r.missingSelections.find(m=>m.key===k)?.similar ?? []; return sim.length ? <div className="warn-text">같은 이름 다른 식별: {sim.map(s=>s.label.detail).join(', ')} — 확인 후 다시 선택(자동 변경 안 함)</div> : <div className="muted">식별 정보 변경 또는 거래 삭제 — 선택 해제 가능</div>; })()}
        </td>
        {(['impact','control'] as const).map(g=><td key={g}><input type="checkbox" aria-label={`${label.name} ${GROUP_LABEL[g]}`} checked={o[g].includes(k)} disabled={missing && !o[g].includes(k)} onChange={(e: any)=>change(x=>{x[g]=e.target.checked?[...new Set([...x[g],k])]:x[g].filter(v=>v!==k);})}/></td>)}
        <td>{missing ? '—' : <details><summary>{validObservationLocation(w.complexInfo.find(c=>c.complexKey===k)?.location) ? '기록 있음' : '미확인 · 입력'}</summary><CoordField label={label.name + ' 좌표'} value={w.complexInfo.find(c=>c.complexKey===k)?.location} onChange={loc=>update(x=>{
          let info=x.complexInfo.find(c=>c.complexKey===k);
          if (!info) { info={complexKey:k}; x.complexInfo.push(info); }
          info.location=loc; info.locationSource=loc ? '사용자 입력' : undefined;
        })}/></details>}</td></tr>)}
      {!complexes.length && !missingRows.length && <tr><td colSpan={4} className="muted">거래 자료 없음</td></tr>}
    </tbody></table></div>
    {r.warnings.length > 0 && <ul className="small warn-text" data-testid="obs-warnings">{r.warnings.map((s,i)=><li key={i}>{s}</li>)}</ul>}
    <div className="table-scroll"><table className="tbl small" data-testid="obs-results"><thead><tr><th>그룹</th><th>양기간 단지/면적구간</th><th>전 표본</th><th>후 표본</th><th>전 전용평당 중위</th><th>후 전용평당 중위</th><th>관측 변동률</th></tr></thead><tbody>{(['impact','control'] as const).map(g=><tr key={g}><td>{g==='impact'?'영향권':'수동 확인 비교군'}</td><td>{r[g].complexes}/{r[g].strata}</td><td>{r[g].pre.count}건</td><td>{r[g].post.count}건</td><td>{fmtExclusivePyeong(r[g].pre.medianPerM2)}</td><td>{fmtExclusivePyeong(r[g].post.medianPerM2)}</td><td>{fmtPct(r[g].changePct)}</td></tr>)}</tbody></table></div>
    <p className="small muted" data-testid="obs-basis">분석 기준일 {r.basis.asOf} · 단위 {r.basis.unit} · 출처 {r.basis.sources.join(', ') || '해당 거래 없음'}{r.basis.dataModes.length ? ` · 자료 ${r.basis.dataModes.join('·')}` : ''}</p>
    <p data-testid="obs-difference">{r.valid && r.differencePp !== null ? <><b>비교군 대비 관측 차이 {fmtPp(r.differencePp)}</b> <span className="muted small">(인과효과 아님 · 관측된 차이)</span></> : <span className="warn-text">비교 불가 — 유효한 비교가 아니어서 비교군 대비 차이를 표시하지 않음(위 경고 참고)</span>}</p>
    <details data-testid="obs-usage"><summary className="small">사용·제외 단지와 제외 이유 · 가격·면적 기준</summary>
      <p className="small muted">가격 기준: 전용㎡당 거래가(원 단위 계산, 표시는 만원) · 면적 기준: {r.basis.area ? `본건 전용 ${r.basis.area.m2}㎡ ±${r.basis.area.bandPct}% (${r.basis.area.min.toFixed(1)}~${r.basis.area.max.toFixed(1)}㎡)` : '본건 전용면적 미입력'} · 같은 단지 × 전용면적 {r.basis.stratumM2}㎡ 구간에 전·후 양쪽 거래가 있는 표본만 사용 · 기간별 최소 {r.basis.minSample}건</p>
      <div className="table-scroll"><table className="tbl small"><thead><tr><th>그룹</th><th>단지</th><th>사용</th><th>전/후 건수</th><th>면적구간</th><th>제외·미사용 이유</th></tr></thead><tbody>
        {r.usage.map((u) => <tr key={u.group + u.key} className={u.used ? '' : 'excluded'}><td>{GROUP_LABEL[u.group]}</td><td className="name-cell">{u.label}</td><td>{u.used ? '사용' : '미사용'}</td><td>{u.pre}/{u.post}</td><td>{u.strata}</td><td className="wide-cell">{[u.reason, ...Object.entries(u.excluded).map(([k, n]) => `${k} ${n}건`)].filter(Boolean).join(' · ') || '-'}</td></tr>)}
        {!r.usage.length && <tr><td colSpan={6} className="muted">선택한 단지 없음</td></tr>}
      </tbody></table></div>
    </details>
    <details data-testid="obs-notes"><summary className="small">계산 기준·한계(항상 적용) {r.notes.length}개</summary><ul className="small">{r.notes.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
    <details><summary>월별 중위 단가 추이(만원/전용㎡) · 동일 분석 표본</summary><div className="table-scroll"><table className="tbl small"><thead><tr><th>월</th><th>영향권 중위/건수</th><th>비교군 중위/건수</th></tr></thead><tbody>{r.monthly.map(m=><tr key={m.month}><td>{m.month}</td><td>{fmtMan(m.impact)} / {m.impactN}건</td><td>{fmtMan(m.control)} / {m.controlN}건</td></tr>)}</tbody></table></div><p className="small">경계 월은 일부 날짜만 포함합니다. 거래 없는 달은 0원이 아닌 미산출로 표시합니다.</p></details>
  </div>;
}
