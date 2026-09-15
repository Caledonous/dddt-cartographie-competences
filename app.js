const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const appEl = document.getElementById("app");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");

const STEPS = ["intro", "identite", "competences", "supplementaires", "texte_libre", "recap", "done"];
const STEP_LABELS = {
  identite: "1 · Votre identité",
  competences: "2 · Vos compétences",
  supplementaires: "3 · Compétences complémentaires",
  texte_libre: "4 · Autre chose à ajouter",
  recap: "5 · Vérification",
};

let state = {
  step: "intro",
  loaded: false,
  nom: "",
  prenom: "",
  competences: [],
  competencesByDomaine: new Map(), // domaine -> [competences]
  autres: [],
  autresByCategorie: new Map(),
  niveaux: [],
  ratings: new Map(),       // competence_id -> niveau
  autresChecked: new Map(), // autre_competence_id -> {precision}
  texteLibre: "",
  openDomaines: new Set(),  // thématiques dépliées
  submitting: false,
  error: null,
};

async function loadData() {
  const [competencesRes, autresRes, niveauxRes] = await Promise.all([
    db.from("competences").select("id, libelle, famille, domaine").order("libelle"),
    db.from("autres_competences").select("id, categorie, libelle").order("categorie"),
    db.from("niveaux_competence").select("niveau, libelle, description").order("niveau"),
  ]);

  for (const r of [competencesRes, autresRes, niveauxRes]) {
    if (r.error) throw r.error;
  }

  state.competences = competencesRes.data;
  state.competencesByDomaine = new Map();
  for (const c of competencesRes.data) {
    if (!state.competencesByDomaine.has(c.domaine)) state.competencesByDomaine.set(c.domaine, []);
    state.competencesByDomaine.get(c.domaine).push(c);
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
  const pct = (idx / (STEPS.length - 2)) * 100;
  progressFill.style.width = `${Math.min(pct, 100)}%`;
  progressLabel.textContent = STEP_LABELS[state.step] || "";
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
      <label for="${name}-skip">Pas concerné</label>
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
    case "competences": return renderCompetences();
    case "supplementaires": return renderSupplementaires();
    case "texte_libre": return renderTexteLibre();
    case "recap": return renderRecap();
    case "done": return renderDone();
  }
}

function renderIntro() {
  appEl.innerHTML = `
    <div class="step">
      <h1>Cartographie des compétences de la DDDT</h1>
      <p class="lead">
        Ce questionnaire recense les compétences de chaque agent de la direction, par grande thématique
        (informatique, réglementation, sciences naturelles, agronomie...). Vous notez uniquement ce qui vous
        concerne — pas besoin de tout remplir. Vos réponses sont associées à votre nom, afin de pouvoir
        identifier qui détient quelle compétence en cas de besoin ponctuel.
      </p>
      <div class="card">
        <strong>Comment ça se passe</strong>
        <p style="color:var(--muted); margin: 8px 0 0;">
          Vous indiquez votre identité, puis vous dépliez les thématiques qui vous concernent pour noter vos
          compétences. Vous pouvez aussi cocher des compétences complémentaires (permis, langues...) et ajouter
          un mot libre en fin de parcours. Comptez 5 à 10 minutes.
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
  nextBtn.addEventListener("click", () => setStep("competences"));
}

function renderCompetences() {
  const domaines = [...state.competencesByDomaine.keys()].sort((a, b) => a.localeCompare(b, "fr"));

  appEl.innerHTML = `
    <div class="step">
      <h1>Vos compétences</h1>
      <p class="lead">
        Dépliez les thématiques qui vous concernent et notez votre niveau sur les compétences précises.
        Inutile d'ouvrir les thématiques qui ne vous concernent pas.
      </p>
      <div id="accordion"></div>
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn">Continuer</button>
      </div>
    </div>`;

  const acc = document.getElementById("accordion");

  function renderAccordion() {
    acc.innerHTML = domaines.map(dom => {
      const comps = state.competencesByDomaine.get(dom).slice().sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
      const isOpen = state.openDomaines.has(dom);
      const nbRated = comps.filter(c => state.ratings.has(c.id)).length;
      return `
        <div class="acc-item">
          <button class="acc-header" data-dom="${escapeHtml(dom)}" type="button">
            <span>${escapeHtml(dom)}</span>
            <span class="acc-meta">${nbRated > 0 ? `${nbRated} notée${nbRated>1?"s":""} · ` : ""}${comps.length} compétence${comps.length>1?"s":""} ${isOpen ? "▲" : "▼"}</span>
          </button>
          <div class="acc-body" ${isOpen ? "" : "hidden"}>
            ${comps.map(c => `
              <div class="comp-row">
                <div class="comp-label">${escapeHtml(c.libelle)}</div>
                ${levelSelectorHtml(`comp-${c.id}`, state.ratings.get(c.id))}
              </div>
            `).join("")}
          </div>
        </div>`;
    }).join("");

    acc.querySelectorAll(".acc-header").forEach(btn => {
      btn.addEventListener("click", () => {
        const dom = btn.dataset.dom;
        if (state.openDomaines.has(dom)) state.openDomaines.delete(dom);
        else state.openDomaines.add(dom);
        renderAccordion();
      });
    });

    domaines.forEach(dom => {
      const comps = state.competencesByDomaine.get(dom);
      comps.forEach(c => {
        document.getElementsByName(`comp-${c.id}`).forEach(input => {
          input.addEventListener("change", (e) => {
            if (e.target.value === "") state.ratings.delete(c.id);
            else state.ratings.set(c.id, parseInt(e.target.value));
            renderAccordion();
          });
        });
      });
    });
  }
  renderAccordion();

  document.getElementById("back-btn").addEventListener("click", () => setStep("identite"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("supplementaires"));
}

function renderSupplementaires() {
  const categories = [...state.autresByCategorie.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));

  appEl.innerHTML = `
    <div class="step">
      <h1>Compétences complémentaires</h1>
      <p class="lead">
        Permis, langues, habilitations, savoir-faire pratiques… Cochez tout ce qui vous concerne,
        même si ça ne fait pas partie de votre poste habituel.
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

  document.getElementById("back-btn").addEventListener("click", () => setStep("competences"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("texte_libre"));
}

function renderTexteLibre() {
  appEl.innerHTML = `
    <div class="step">
      <h1>Autre chose à ajouter ?</h1>
      <p class="lead">
        Une compétence, une expérience ou un savoir-faire qui ne figure nulle part ailleurs dans ce
        questionnaire ? Décrivez-le librement ici. Cette étape est facultative.
      </p>
      <textarea id="texte-libre-input" class="search-box" rows="6" style="resize:vertical; font-family:inherit;"
        placeholder="Écrivez ici tout ce que vous voulez ajouter…">${escapeHtml(state.texteLibre)}</textarea>
      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn">Retour</button>
        <button class="btn btn-primary" id="next-btn">Continuer</button>
      </div>
    </div>`;

  document.getElementById("texte-libre-input").addEventListener("input", (e) => {
    state.texteLibre = e.target.value;
  });

  document.getElementById("back-btn").addEventListener("click", () => setStep("supplementaires"));
  document.getElementById("next-btn").addEventListener("click", () => setStep("recap"));
}

function niveauLibelle(n) {
  const found = state.niveaux.find(x => x.niveau === n);
  return found ? found.libelle : "";
}

function renderRecap() {
  const competencesById = new Map(state.competences.map(c => [c.id, c]));
  const rated = [...state.ratings.entries()];
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
        <h3>Compétences notées (${rated.length})</h3>
        <div class="card">
          ${rated.length ? rated.map(([id, n]) => `
            <div class="recap-item"><span>${escapeHtml(competencesById.get(id).libelle)}</span><span class="lvl">${escapeHtml(niveauLibelle(n))}</span></div>
          `).join("") : `<span style="color:var(--muted)">Aucune compétence notée</span>`}
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

      <div class="recap-section">
        <h3>Texte libre</h3>
        <div class="card">${state.texteLibre.trim() ? escapeHtml(state.texteLibre) : `<span style="color:var(--muted)">Rien d'ajouté</span>`}</div>
      </div>

      <div class="nav-row">
        <button class="btn btn-secondary" id="back-btn" ${state.submitting ? "disabled" : ""}>Retour</button>
        <button class="btn btn-primary" id="submit-btn" ${state.submitting ? "disabled" : ""}>
          ${state.submitting ? "Envoi…" : "Envoyer ma réponse"}
        </button>
      </div>
    </div>`;

  document.getElementById("back-btn").addEventListener("click", () => setStep("texte_libre"));
  document.getElementById("submit-btn").addEventListener("click", submitReponse);
}

async function submitReponse() {
  state.submitting = true;
  state.error = null;
  render();

  try {
    const { data: reponse, error: repError } = await db
      .from("reponses")
      .insert({ nom: state.nom.trim(), prenom: state.prenom.trim(), texte_libre: state.texteLibre.trim() || null })
      .select()
      .single();
    if (repError) {
      if (repError.code === "23505") {
        throw new Error(`Une réponse a déjà été enregistrée pour ${state.prenom.trim()} ${state.nom.trim()}. Si vous pensez qu'il s'agit d'une erreur, contactez le pilote du projet.`);
      }
      throw repError;
    }
    const reponseId = reponse.id;

    const compRows = [...state.ratings.entries()].map(([competence_id, niveau]) => ({
      reponse_id: reponseId, competence_id, niveau,
    }));
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
