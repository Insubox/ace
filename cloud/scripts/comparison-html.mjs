/** Self-contained offline view. Candidate data never becomes HTML markup. */
export function comparisonHtml(report) {
  const data = JSON.stringify(report).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ACE · Comparación de recomendaciones</title><style>
body{font:16px system-ui,sans-serif;color:#172b3a;background:#f4f7fa;margin:0;padding:32px}main{max-width:1100px;margin:auto}h1{font-size:28px}.note{background:#fff4d6;padding:18px;border-radius:12px;line-height:1.6}select{font:inherit;padding:10px;margin:20px 0}.stats{display:flex;gap:16px;flex-wrap:wrap}.stat{background:white;border:1px solid #dbe3e9;border-radius:10px;padding:16px;min-width:150px}.stat strong{display:block;font-size:25px;margin-top:8px}table{width:100%;border-collapse:collapse;background:white;margin-top:24px}th,td{text-align:left;padding:13px;border-bottom:1px solid #dbe3e9}.scroll{overflow:auto}.foot{font-size:14px;color:#415568;line-height:1.6;overflow-wrap:anywhere}
</style><main><h1>Comparación de recomendaciones de IA</h1>
<p class="note">Los descartes mostrados son hipotéticos. Los resultados reales siguen decidiendo qué candidatos son válidos. Esta comparación usa respuestas guardadas y no autoriza descartes automáticos.</p>
<label for="mode">Ruta de evaluación: </label><select id="mode"><option value="bypass">Pruebas reales</option><option value="flash_only">Clef-flash</option><option value="flash_then_clef">Clef-flash + segunda opinión</option></select>
<div class="stats" id="stats"></div><div class="scroll"><table><thead><tr><th>Candidato</th><th>Resultado real</th><th>Ganador</th><th>Recomendación hipotética</th><th>Segunda opinión</th></tr></thead><tbody id="rows"></tbody></table></div>
<p class="foot" id="telemetry"></p><p class="foot">Los tokens y las latencias corresponden a los registros incluidos. No miden ahorro de ejecución, facturación ni tiempo total hasta encontrar al ganador. Una muestra pequeña no demuestra fiabilidad en producción.</p><p class="foot" id="identity"></p><noscript>Activa JavaScript para explorar las tres rutas de este informe.</noscript></main>
<script type="application/json" id="data">${data}</script><script>
const report=JSON.parse(document.getElementById('data').textContent);
const labels={qualified:'Válido',correctness_failure:'Resultado incorrecto',contract_failure:'Contrato inválido',resource_failure:'Límite de recursos',infrastructure_failure:'Evaluación incompleta'};
function render(){const arm=report.arms.find(a=>a.mode===document.getElementById('mode').value);const stats=document.getElementById('stats');stats.replaceChildren();
for(const [label,value] of [['Descartes hipotéticos',arm.hypothetical_filtered],['Válidos conservados',(arm.qualified_count-arm.hypothetical_filtered_qualified)+' / '+arm.qualified_count],['Ganadores conservados',(arm.winner_count-arm.hypothetical_filtered_winners)+' / '+arm.winner_count],['Registros de consulta',arm.included_attempts]]){const card=document.createElement('div');card.className='stat';card.textContent=label;const v=document.createElement('strong');v.textContent=value;card.append(v);stats.append(card);}
const rows=document.getElementById('rows');rows.replaceChildren();for(const c of arm.candidates){const row=document.createElement('tr');for(const value of [c.candidate,labels[c.label],c.winner?'Sí':'—',c.would_filter?'Descartar':c.audit_holdout?'Conservar por auditoría':'Conservar',c.second_opinion_missing?'Falta respuesta':c.second_opinion_requested?'Solicitada':'—']){const td=document.createElement('td');td.textContent=value;row.append(td);}rows.append(row);}
document.getElementById('telemetry').textContent='Tokens de entrada incluidos: '+arm.input_tokens.toLocaleString('es-MX')+'. Suma de latencias registradas: '+arm.included_latency_sum_ms+' ms. Consultas sin datos de consumo: '+arm.missing_usage_attempts+'. Segundas opiniones faltantes: '+arm.missing_second_opinions+'.';
document.getElementById('identity').textContent=(report.synthetic_predictions?'Datos sintéticos. ':'Respuestas registradas; etiquetas contrastadas con evidencia. ')+'Huella del conjunto: '+report.dataset_hash;}
document.getElementById('mode').addEventListener('change',render);render();
</script></html>`;
}
