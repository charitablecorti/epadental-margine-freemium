// Funzione serverless: gira sul server di Netlify, mai nel browser del visitatore.
// La chiave API resta segreta qui dentro (variabile d'ambiente ANTHROPIC_API_KEY, già configurata).

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Richiesta non valida" }) };
  }

  const prestazione = (body.prestazione || "").toString().trim();
  const note = (body.note || "").toString().trim();
  const durata = Number(body.durata);
  const costoOrario = body.costoOrario !== "" && body.costoOrario != null ? Number(body.costoOrario) : null;
  const onorario = body.onorario !== "" && body.onorario != null ? Number(body.onorario) : null;

  if (!prestazione) {
    return { statusCode: 400, body: JSON.stringify({ error: "Prestazione mancante" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Chiave API non configurata sul server (ANTHROPIC_API_KEY mancante)" }),
    };
  }

  const prompt = `Sei un esperto di costi dei materiali odontoiatrici in Italia (listini fornitori, cataloghi dentali, prassi di studio).
Prestazione odontoiatrica: "${prestazione}"
${note ? "Note aggiuntive fornite dal dentista: " + note : "Nessuna nota aggiuntiva fornita: usa un caso standard/medio per questa prestazione."}

Stima il costo dei SOLI materiali/consumabili chair-side necessari per eseguire questa prestazione in uno studio dentistico italiano (escludi tempo poltrona, onorario, quota laboratorio odontotecnico esterno se non pertinente ai materiali).

Rispondi SOLO con un oggetto JSON con questa struttura esatta, senza testo prima o dopo, senza blocchi di codice markdown:
{"min_eur": numero, "max_eur": numero, "suggested_eur": numero, "materials": ["stringa breve", "..."]}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: "Errore dal servizio AI", detail: errText }) };
    }

    const data = await resp.json();
    const rawText = (data.content && data.content[0] && data.content[0].text) || "";

    let materialsData;
    try {
      materialsData = JSON.parse(rawText);
    } catch (e) {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        materialsData = JSON.parse(match[0]);
      } else {
        throw new Error("Risposta AI non interpretabile");
      }
    }

    const costoMateriali = Number(materialsData.suggested_eur);

    let margine = null;
    let marginePct = null;
    let costiFissi = null;
    let approssimato = true;

    if (isFinite(durata) && durata > 0 && costoOrario != null && isFinite(costoOrario) && onorario != null && isFinite(onorario)) {
      costiFissi = durata * costoOrario;
      margine = onorario - costoMateriali - costiFissi;
      marginePct = onorario > 0 ? margine / onorario : null;
      approssimato = false;
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        min_eur: materialsData.min_eur,
        max_eur: materialsData.max_eur,
        suggested_eur: materialsData.suggested_eur,
        materials: materialsData.materials || [],
        costiFissi,
        margine,
        marginePct,
        approssimato,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Errore imprevisto" }) };
  }
};
