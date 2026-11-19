import type { SectionProps } from '../AnalysisView.tsx';
import { complexKeyOf, MILESTONE_LABEL } from '../../shared/model.ts';
import { observationOptions, observeGroups, type ObservationOptions } from '../../shared/observation.ts';
export function ObservationPanel({rec, update}: Pick<SectionProps,'rec'|'update'>) {
  const w=rec.working, o=observationOptions(w), r=observeGroups(w);
  const change=(fn:(x:ObservationOptions)=>void)=>update(x=>{x.observation=observationOptions(x);fn(x.observation);});
  const complexes=[...new Map(w.transactions.map(t=>[complexKeyOf(t),t])).entries()];
  const ev=w.events.find(e=>e.key===o.eventKey);
  const fmt=(n:number|null)=>n===null?'미산출':n.toLocaleString('ko-KR',{maximumFractionDigits:2});
  return <div data-testid="observation-panel">
    <h4>영향권 / 수동 확인 비교군의 관측 분석 · v0.6</h4>
    <p className="small">현재 입력 기준으로 즉시 갱신됩니다(기존 실행 결과와 별도). 그룹을 체크하면 사용자가 직접 확인한 단지로 기록됩니다. 자동 반경 선정은 제공하지 않습니다.</p>
    <div className="toolbar">
      <label>사건 <select data-testid="obs-event" value={o.eventKey??''} onChange={(e: any)=>change(x=>{x.eventKey=e.target.value;x.milestoneKey=undefined;})}><option value="">선택</option>{w.events.map(e=><option key={e.key} value={e.key}>{e.name}</option>)}</select></label>
      <label>실제 기록 일정 <select data-testid="obs-milestone" value={o.milestoneKey??''} onChange={(e: any)=>change(x=>{x.milestoneKey=e.target.value;})}><option value="">선택</option>{ev?.milestones.filter(m=>m.status==='actual'&&m.date).map(m=><option key={m.key} value={m.key}>{MILESTONE_LABEL[m.type]} · {m.date}</option>)}</select></label>
      <label>전후 기간 <select data-testid="obs-months" value={o.months} onChange={(e: any)=>change(x=>{x.months=Number(e.target.value) as 3|6|12;})}>{[3,6,12].map(n=><option key={n} value={n}>{n}개월</option>)}</select></label>
    </div>
    <p className="small">기준 {r.anchor||'미선택'} · 전 [{r.start||'—'}, 기준일) / 후 [기준일, {r.end||'—'}) · 기준일 당일은 후에 포함. 전용면적은 기본 입력, 허용범위·최소 표본은 기존 분석 옵션을 사용합니다.</p>
    <div className="table-scroll"><table className="tbl small" data-testid="obs-groups"><thead><tr><th>단지·식별</th><th>수동 확인 영향권</th><th>수동 확인 비교군</th><th>좌표</th></tr></thead><tbody>{complexes.map(([k,t])=><tr key={k}><td>{t.complexName}<div className="muted">{k}</div></td>{(['impact','control'] as const).map(g=><td key={g}><input type="checkbox" aria-label={`${t.complexName} ${g}`} checked={o[g].includes(k)} onChange={(e: any)=>change(x=>{x[g]=e.target.checked?[...new Set([...x[g],k])]:x[g].filter(v=>v!==k);})}/></td>)}<td>{w.complexInfo.find(c=>c.complexKey===k)?.location?'기록 있음(별도 확인 필요)':'미확인'}</td></tr>)}</tbody></table></div>
    <ul className="small warn-text" data-testid="obs-warnings">{r.warnings.map((s,i)=><li key={i}>{s}</li>)}</ul>
    <div className="table-scroll"><table className="tbl small" data-testid="obs-results"><thead><tr><th>그룹</th><th>양기간 단지/면적구간</th><th>전 표본</th><th>후 표본</th><th>전 중위 원/㎡</th><th>후 중위 원/㎡</th><th>관측 변동률</th></tr></thead><tbody>{(['impact','control'] as const).map(g=><tr key={g}><td>{g==='impact'?'영향권':'수동 확인 비교군'}</td><td>{r[g].complexes}/{r[g].strata}</td><td>{r[g].pre.count}</td><td>{r[g].post.count}</td><td>{fmt(r[g].pre.medianPerM2)}</td><td>{fmt(r[g].post.medianPerM2)}</td><td>{fmt(r[g].changePct)}{r[g].changePct!==null?'%':''}</td></tr>)}</tbody></table></div>
    <p data-testid="obs-difference">영향권 − 비교군 변동률 차이: {fmt(r.differencePp)}{r.differencePp!==null?'%p':''} (인과 효과 아님)</p>
    <details><summary>월별 중위 단가 추이(원/㎡) · 동일 분석 표본</summary><table className="tbl small"><thead><tr><th>월</th><th>영향권 중위/건수</th><th>비교군 중위/건수</th></tr></thead><tbody>{r.monthly.map(m=><tr key={m.month}><td>{m.month}</td><td>{fmt(m.impact)} / {m.impactN}</td><td>{fmt(m.control)} / {m.controlN}</td></tr>)}</tbody></table><p className="small">경계 월은 일부 날짜만 포함합니다. 거래 없는 달은 0원이 아닌 미산출로 표시합니다.</p></details>
  </div>;
}
