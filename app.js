const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const appEl = document.getElementById("app");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");

const STEPS = ["intro", "identite", "emplois", "competences", "horsmetier", "autres", "recap", "done"];
const STEP_LABELS = {
  identite: "1 · Votre identité",
  emplois: "2 · Votre métier",
  competences: "3 · Vos compétences métier",
  horsmetier: "4 · Autre expertise",
  autres: "5 · Compétences complémentaires",
  recap: "6 · Vérification",
};

let state = {
  step: "intro",
  loaded: false,
  nom: "",
  prenom: "",
  emplois: [],
  competences: [],
  competencesById: new Map(),
  emploiCompetenceMap: new Map(), // emploi_id -> Set(competence_id)
  autres: [],
  autresByCategorie: new Map(),
  niveaux: [],
  selectedEmplois: new Set(),
  ratings: new Map(),      // competence_id -> niveau (métier)
  horsMetier: new Map(),   // competence_id -> niveau (hors métier)
  autresChecked: new Map(),// autre_competence_id -> {precision}
  submitting: false,
  error: null,
};

async function loadData() {
  const [emploisRes, competencesRes, ecRes, autresRes, niveauxRes] = await Promise.all([
    db.from("emplois_types").select("id, libelle, nb_agents_reference").order("libelle"),
    db.from("competences").select("id, libelle, famille, domaine"),
    db.from("emplois_competences").select("emploi_type_id, competence_id"),
    db.from("autres_competences").select("id, categorie, libelle").order("categorie"),
    db.from("niveaux_competence").select("niveau, libelle, description").order("niveau"),
  ]);

  for (const r of [emploisRes, competencesRes, ecRes, autresRes, niveauxRes]) {
    if (r.error) throw r.error;
  }

  state.emplois = emploisRes.data;
  state.competences = competencesRes.data;
  state.competencesById = new Map(competencesRes.data.map(c => [c.id, c]));

  state.emploiCompetenceMap = new Map();
  for (const row of ecRes.data) {
    if (!state.emploiCompetenceMap.has(row.emploi_type_id)) {
      state.emploiCompetenceMap.set(row.emploi_type_id, new Set());
    }
    state.emploiCompetenceMap.get(row.emploi_type_id).add(row.competence_id);
  }

  state.autres = autresRes.data;
  state.autresByCategorie = new Map();
  for (const a of autresRes.data) {
    if (!state.autresByCategorie.has(a.categorie)) state.autresByCategorie.set(a.categorie, []);
    state.autresByCategorie.get(a.categorie).push(a);
  }

  state.niveaux = niveauxRes.data;
  state.loaded = true;
}

function setStep(step) {
  state.step = step;
  render();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function updateProgress() {
  const idx = STEPS.indexOf(state.step);
  if (idx <= 0 || state.step === "done") {
    progressEl.hidden = true;
    return;
  }
  progressEl.hidden = false;
  const pct = (idx / (STEPS.length - 2)) * 100; // exclude intro & done from denominator
  progressFill.style.width = `${Math.min(pct, 100)}%`;
  progressLabel.textContent = STEP_LABELS[state.step] || "";
}

function getMetierCompetenceIds() {
  const ids = new Set();
  for (const emploiId of state.selectedEmplois) {
    const set = state.emploiCompetenceMap.get(emploiId);
    if (set) for (const id of set) ids.add(id);
  }
  return ids;
}

function groupByDomaine(competences) {
  const groups = new Map();
  for (const c of competences) {
    const key = c.domaine || "Autres compétences";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
}

function levelSelectorHtml(name, currentValue) {
  const opts = state.niveaux.map(n =>
    `<div class="level-option">
      <input type="radio" name="${name}" id="${name}-${n.niveau}" value="${n.niveau}" ${currentValue === n.niveau ? "checked" : ""}>
      <label for="${name}-${n.niveau}" title="${escapeHtml(n.description || "")}">${escapeHtml(n.libelle)}</label>
    </div>`
  ).join("");
  const skipChecked = currentValue === undefined || currentValue === null;
  return `<div class="level-select">
    ${opts}
    <div class="level-option skip">
      <input type="radio" name="${name}" id="${name}-skip" value="" ${skipChecked ? "checked" : ""}>
      <label for="${name}-skip">Sans avis</label>
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

/* ---------------- RENDER ---------------- */

function render() {
  updateProgress();

  if (!state.loaded && state.step !== "intro") {
    appEl.innerHTML = `<div class="loading">Chargement…</div>`;
    return;
  }

  switch (state.step) {
    case "intro": return renderIntro();
    case "identite": return renderIdentite();
    case "emplois": return renderEmplois();
    case "competences": return renderCompetences();
    case "horsmetier": return renderHorsMetier();
    case "autres": return renderAutres();
    case "recap": return renderRecap();
    case "done": return renderDone();
  }
}

function renderIntro() {
  appEl.innerHTML = `
    <div class="step">
      <h1>Cartographie des compétences de la DDDT</h1>
      <p class="lead">
        Ce court questionnaire recense les compétences de chaque agent de la direction — celles liées à votre métier,
        mais aussi toute expertise que vous possédez au-delà (langues, permis, savoir-faire pratiques…).
        Vos réponses sont associées à votre nom, afin de pouvoir identifier qui détient quelle compétence
        en cas de besoin ponctuel.
      </p>
      <div class="card">
        <strong>Comment ça se passe</strong>
        <p style="color:var(--muted); margin: 8px 0 0;">
          Vous indiquez votre identité et votre métier, vous notez les compétences qui y sont liées, puis vous pouvez
          ajouter librement toute autre compétence que vous possédez. Comptez 5 à 10 minutes.
        </p>
      </div>
      <div class="nav-row" style="justify-content:flex-start;">
        <button class="btn btn-primary" id="start-btn">Commencer</button>
      </div>
    </div>`;
  document.getElementById("start-btn").addEventListener("click", async () => {
    if (!state.loaded) {
      appEl.innerHTML = `<div class="loading">Chargement du questionnaire…</div>`;
      try {
        await loadData();
      } catch (e) {
        appEl.innerHTML = `<div class="error-banner">Impossible de charger le questionnaire. Vérifiez votre connexion et réessayez.</div>`;
        return;
      }
    }
    setStep("identite");
  });
}

function renderIdentite() {
  const canContinue = state.nom.trim().length > 0 && state.prenom.trim().length > 0;
  appEl.innerHTML = `
    <div class="step">
      <h1>Qui êtes-vous ?</h1>
      <p class="lead">Vos nom et prénom permettront de savoir qui détient quelle compétence.</p>
      <div class="card">
        <label style="display:block; font-weight:500; margin-bottom:6px;">Nom</label>
        <input type="text" class="search-box" id="id-nom" placeholder="Votre nom" value="${escapeHtml(state.nom)}">
        <label style="display:block; font-weight:500; margin-bottom:6px;">Prénom</label>
        <input type="text" class="search-box" id="id-prenom" placeholder="Votre prénom" value="${escapeHtml(state.prenom)}" style="margin-bottom:0;">
      </div>
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn" ${canContinue ? "" : "disabled"}>Continuer</button>
      </div>
    </div>`;

  const nomInput = document.getElementById("id-nom");
  const prenomInput = document.getElementById("id-prenom");
  const nextBtn = document.getElementById("next-btn");

  function syncBtn() {
    nextBtn.disabled = !(state.nom.trim().length > 0 && state.prenom.trim().length > 0);
  }
  nomInput.addEventListener("input", () => { state.nom = nomInput.value; syncBtn(); });
  prenomInput.addEventListener("input", () => { state.prenom = prenomInput.value; syncBtn(); });

  document.getElementById("back-btn").addEventListener("click", () => setStep("intro"));
  nextBtn.addEventListener("click", () => setStep("emplois"));
}

function renderEmplois() {
  const search = state._emploiSearch || "";
  const filtered = state.emplois.filter(e =>
    e.libelle.toLowerCase().includes(search.toLowerCase())
  );

  appEl.innerHTML = `
    <div class="step">
      <h1>Quel est votre métier ?</h1>
      <p class="lead">Sélectionnez le ou les emplois-types qui correspondent à votre poste. La plupart des agents n'en ont qu'un.</p>
      <input type="text" class="search-box" id="emploi-search" placeholder="Rechercher un métier…" value="${escapeHtml(search)}">
      <div class="option-list" id="emploi-list">
        ${filtered.map(e => `
          <div class="option-row" data-id="${e.id}">
            <input type="checkbox" ${state.selectedEmplois.has(e.id) ? "checked" : ""}>
            <div>
              <div class="option-main">${escapeHtml(e.libelle)}</div>
            </div>
          </div>
        `).join("") || `<div class="option-row"><span class="option-sub">Aucun résultat</span></div>`}
      </div>
      <div class="selected-tags" id="selected-tags">
        ${[...state.selectedEmplois].map(id => {
          const e = state.emplois.find(x => x.id === id);
          return `<span class="tag">${escapeHtml(e ? e.libelle : "")}<button data-remove="${id}">&times;</button></span>`;
        }).join("")}
      </div>
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn" ${state.selectedEmplois.size === 0 ? "disabled" : ""}>Continuer</button>
      </div>
    </div>`;

  document.getElementById("emploi-search").addEventListener("input", (e) => {
    state._emploiSearch = e.target.value;
    render();
    document.getElementById("emploi-search").focus();
    document.getElementById("emploi-search").selectionStart = document.getElementById("emploi-search").value.length;
  });

  document.querySelectorAll("#emploi-list .option-row[data-id]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.tagName === "INPUT") return;
      toggleEmploi(parseInt(row.dataset.id));
    });
    row.querySelector("input").addEventListener("change", () => toggleEmploi(parseInt(row.dataset.id)));
  });

  document.querySelectorAll("#selected-tags button[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => toggleEmploi(parseInt(btn.dataset.remove)));
  });

  document.getElementById("back-btn").addEventListener("click", () => setStep("identite"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("competences"));
}

function toggleEmploi(id) {
  if (state.selectedEmplois.has(id)) state.selectedEmplois.delete(id);
  else state.selectedEmplois.add(id);
  render();
}

function renderCompetences() {
  const ids = getMetierCompetenceIds();
  const competences = [...ids].map(id => state.competencesById.get(id)).filter(Boolean);
  const groups = groupByDomaine(competences);

  appEl.innerHTML = `
    <div class="step">
      <h1>Vos compétences métier</h1>
      <p class="lead">
        Pour chaque compétence, indiquez votre niveau. Vous pouvez laisser "Sans avis" si elle ne vous concerne pas
        ou si vous préférez ne pas répondre.
      </p>
      ${groups.map(([domaine, comps]) => `
        <div class="domain-group">
          <div class="domain-title">${escapeHtml(domaine)}</div>
          ${comps.map(c => `
            <div class="comp-row">
              <div class="comp-label">${escapeHtml(c.libelle)}</div>
              ${levelSelectorHtml(`comp-${c.id}`, state.ratings.get(c.id))}
            </div>
          `).join("")}
        </div>
      `).join("") || `<p class="lead">Aucune compétence rattachée à ce métier pour le moment.</p>`}
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn">Continuer</button>
      </div>
    </div>`;

  competences.forEach(c => {
    document.getElementsByName(`comp-${c.id}`).forEach(input => {
      input.addEventListener("change", (e) => {
        if (e.target.value === "") state.ratings.delete(c.id);
        else state.ratings.set(c.id, parseInt(e.target.value));
      });
    });
  });

  document.getElementById("back-btn").addEventListener("click", () => setStep("emplois"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("horsmetier"));
}

function renderHorsMetier() {
  const metierIds = getMetierCompetenceIds();

  appEl.innerHTML = `
    <div class="step">
      <h1>Une autre expertise ?</h1>
      <p class="lead">
        Vous avez peut-être une compétence utile qui ne fait pas partie de votre métier habituel
        (ex. un agent technique qui maîtrise aussi la comptabilité, une expertise scientifique acquise ailleurs…).
        Cherchez-la et ajoutez-la ici. Cette étape est facultative.
      </p>
      <div class="autocomplete-wrap">
        <input type="text" class="search-box" id="hm-search" placeholder="Rechercher une compétence…" autocomplete="off">
        <div id="hm-results" class="autocomplete-results" hidden></div>
      </div>
      <div id="hm-added"></div>
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn">Continuer</button>
      </div>
    </div>`;

  const searchInput = document.getElementById("hm-search");
  const resultsEl = document.getElementById("hm-results");

  function renderAdded() {
    const addedEl = document.getElementById("hm-added");
    const entries = [...state.horsMetier.entries()];
    addedEl.innerHTML = entries.map(([compId, niveau]) => {
      const c = state.competencesById.get(compId);
      return `
        <div class="added-comp">
          <div style="flex:1">
            <div class="comp-label">${escapeHtml(c.libelle)}</div>
            ${levelSelectorHtml(`hm-${compId}`, niveau)}
          </div>
          <button class="remove-btn" data-remove="${compId}" title="Retirer">&times;</button>
        </div>`;
    }).join("");

    entries.forEach(([compId]) => {
      document.getElementsByName(`hm-${compId}`).forEach(input => {
        input.addEventListener("change", (e) => {
          if (e.target.value === "") state.horsMetier.set(compId, null);
          else state.horsMetier.set(compId, parseInt(e.target.value));
        });
      });
    });
    addedEl.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.horsMetier.delete(parseInt(btn.dataset.remove));
        renderAdded();
      });
    });
  }
  renderAdded();

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) { resultsEl.hidden = true; return; }
    const matches = state.competences
      .filter(c => !metierIds.has(c.id) && !state.horsMetier.has(c.id))
      .filter(c => c.libelle.toLowerCase().includes(q))
      .slice(0, 25);
    if (matches.length === 0) {
      resultsEl.innerHTML = `<div class="autocomplete-item"><span class="meta">Aucun résultat</span></div>`;
      resultsEl.hidden = false;
      return;
    }
    resultsEl.innerHTML = matches.map(c => `
      <div class="autocomplete-item" data-id="${c.id}">
        ${escapeHtml(c.libelle)}
        <div class="meta">${escapeHtml(c.domaine || c.famille)}</div>
      </div>`).join("");
    resultsEl.hidden = false;
    resultsEl.querySelectorAll(".autocomplete-item[data-id]").forEach(item => {
      item.addEventListener("click", () => {
        state.horsMetier.set(parseInt(item.dataset.id), null);
        searchInput.value = "";
        resultsEl.hidden = true;
        renderAdded();
      });
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrap")) resultsEl.hidden = true;
  });

  document.getElementById("back-btn").addEventListener("click", () => setStep("competences"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("autres"));
}

function renderAutres() {
  const categories = [...state.autresByCategorie.entries()].sort((a,b) => a[0].localeCompare(b[0], "fr"));

  appEl.innerHTML = `
    <div class="step">
      <h1>Compétences complémentaires</h1>
      <p class="lead">
        Permis, langues, habilitations, savoir-faire pratiques… Cochez tout ce qui vous concerne,
        même si ça ne fait pas partie de votre fiche de poste.
      </p>
      ${categories.map(([cat, items]) => `
        <div class="domain-group">
          <div class="domain-title">${escapeHtml(cat)}</div>
          ${items.map(a => `
            <div class="check-row">
              <input type="checkbox" id="autre-${a.id}" ${state.autresChecked.has(a.id) ? "checked" : ""}>
              <div style="flex:1">
                <label for="autre-${a.id}" class="label-main">${escapeHtml(a.libelle)}</label>
                <div id="autre-precision-wrap-${a.id}" ${state.autresChecked.has(a.id) ? "" : "hidden"}>
                  <input type="text" class="precision-input" id="autre-precision-${a.id}"
                    placeholder="Précision optionnelle (ex. niveau, référence)"
                    value="${escapeHtml(state.autresChecked.get(a.id)?.precision || "")}">
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      `).join("")}
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn">Continuer</button>
      </div>
    </div>`;

  state.autres.forEach(a => {
    const checkbox = document.getElementById(`autre-${a.id}`);
    const wrap = document.getElementById(`autre-precision-wrap-${a.id}`);
    const input = document.getElementById(`autre-precision-${a.id}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.autresChecked.set(a.id, { precision: "" });
        wrap.hidden = false;
      } else {
        state.autresChecked.delete(a.id);
        wrap.hidden = true;
      }
    });
    input.addEventListener("input", () => {
      if (state.autresChecked.has(a.id)) state.autresChecked.get(a.id).precision = input.value;
    });
  });

  document.getElementById("back-btn").addEventListener("click", () => setStep("horsmetier"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("recap"));
}

function niveauLibelle(n) {
  const found = state.niveaux.find(x => x.niveau === n);
  return found ? found.libelle : "";
}

function renderRecap() {
  const emploisList = [...state.selectedEmplois].map(id => state.emplois.find(e => e.id === id)?.libelle).filter(Boolean);
  const ratedMetier = [...state.ratings.entries()];
  const ratedHorsMetier = [...state.horsMetier.entries()].filter(([, n]) => n !== null && n !== undefined);
  const checkedAutres = [...state.autresChecked.entries()];

  appEl.innerHTML = `
    <div class="step">
      <h1>Vérifiez avant d'envoyer</h1>
      <p class="lead">Voici un résumé de ce qui sera enregistré sous votre nom.</p>

      ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ""}

      <div class="recap-section">
        <h3>Identité</h3>
        <div class="card">${escapeHtml(state.prenom)} ${escapeHtml(state.nom)}</div>
      </div>

      <div class="recap-section">
        <h3>Métier(s)</h3>
        <div class="card">${emploisList.map(escapeHtml).join(", ") || "—"}</div>
      </div>

      <div class="recap-section">
        <h3>Compétences métier notées (${ratedMetier.length})</h3>
        <div class="card">
          ${ratedMetier.length ? ratedMetier.map(([id, n]) => `
            <div class="recap-item"><span>${escapeHtml(state.competencesById.get(id).libelle)}</span><span class="lvl">${escapeHtml(niveauLibelle(n))}</span></div>
          `).join("") : `<span style="color:var(--muted)">Aucune compétence notée</span>`}
        </div>
      </div>

      <div class="recap-section">
        <h3>Autre expertise (${ratedHorsMetier.length})</h3>
        <div class="card">
          ${ratedHorsMetier.length ? ratedHorsMetier.map(([id, n]) => `
            <div class="recap-item"><span>${escapeHtml(state.competencesById.get(id).libelle)}</span><span class="lvl">${escapeHtml(niveauLibelle(n))}</span></div>
          `).join("") : `<span style="color:var(--muted)">Aucune</span>`}
        </div>
      </div>

      <div class="recap-section">
        <h3>Compétences complémentaires (${checkedAutres.length})</h3>
        <div class="card">
          ${checkedAutres.length ? checkedAutres.map(([id, v]) => `
            <div class="recap-item"><span>${escapeHtml(state.autres.find(a => a.id === id).libelle)}${v.precision ? " — " + escapeHtml(v.precision) : ""}</span></div>
          `).join("") : `<span style="color:var(--muted)">Aucune</span>`}
        </div>
      </div>

      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn" ${state.submitting ? "disabled" : ""}>Retour</button>
        <button class="btn btn-primary" id="submit-btn" ${state.submitting ? "disabled" : ""}>
          ${state.submitting ? "Envoi…" : "Envoyer ma réponse"}
        </button>
      </div>
    </div>`;

  document.getElementById("back-btn").addEventListener("click", () => setStep("autres"));
  document.getElementById("submit-btn").addEventListener("click", submitReponse);
}

async function submitReponse() {
  state.submitting = true;
  state.error = null;
  render();

  try {
    const { data: reponse, error: repError } = await db
      .from("reponses")
      .insert({ nom: state.nom.trim(), prenom: state.prenom.trim() })
      .select()
      .single();
    if (repError) {
      if (repError.code === "23505") {
        throw new Error(`Une réponse a déjà été enregistrée pour ${state.prenom.trim()} ${state.nom.trim()}. Si vous pensez qu'il s'agit d'une erreur, contactez le pilote du projet.`);
      }
      throw repError;
    }
    const reponseId = reponse.id;

    const emploisRows = [...state.selectedEmplois].map(emploi_type_id => ({ reponse_id: reponseId, emploi_type_id }));
    if (emploisRows.length) {
      const { error } = await db.from("reponses_emplois").insert(emploisRows);
      if (error) throw error;
    }

    const compRows = [];
    for (const [competence_id, niveau] of state.ratings.entries()) {
      compRows.push({ reponse_id: reponseId, competence_id, niveau, hors_metier: false });
    }
    for (const [competence_id, niveau] of state.horsMetier.entries()) {
      if (niveau === null || niveau === undefined) continue;
      compRows.push({ reponse_id: reponseId, competence_id, niveau, hors_metier: true });
    }
    if (compRows.length) {
      const { error } = await db.from("reponses_competences").insert(compRows);
      if (error) throw error;
    }

    const autresRows = [...state.autresChecked.entries()].map(([autre_competence_id, v]) => ({
      reponse_id: reponseId,
      autre_competence_id,
      possede: true,
      precision: v.precision || null,
    }));
    if (autresRows.length) {
      const { error } = await db.from("reponses_autres_competences").insert(autresRows);
      if (error) throw error;
    }

    state.submitting = false;
    setStep("done");
  } catch (e) {
    console.error(e);
    state.submitting = false;
    state.error = e.message && e.message.startsWith("Une réponse a déjà été enregistrée")
      ? e.message
      : "L'envoi a échoué. Vérifiez votre connexion et réessayez.";
    render();
  }
}

function renderDone() {
  appEl.innerHTML = `
    <div class="end-screen">
      <div class="icon">✓</div>
      <h1>Merci pour votre réponse</h1>
      <p>Votre contribution est enregistrée et alimentera la cartographie des compétences de la DDDT.</p>
    </div>`;
}

/* ---------------- INIT ---------------- */
render();
