"""
train.py — Module 5 : ML Classifier
=====================================
Responsabilites :
  1. Definir l'extraction de features (importe par app.py)
  2. Construire le dataset depuis 3 sources GitHub avec pipeline de preparation
  3. Entrainer un RandomForestClassifier
  4. Sauvegarder le modele + metadonnees avec joblib

Datasets :
  Jetables  : StephaneBour/disposable-email-domains  (config/domains.php)
  Jetables  : c-dome/temporary-email                 (list.txt)
  Jetables  : datasets/*.txt                         (fichiers locaux fournis manuellement)
  Legitimes : etalab/noms-de-domaine-organismes      (domains.csv, administration FR)
  Legitimes : Tranco top 50 000                      (datasets/legitimate/*.txt, sites populaires)

Pipeline de preparation des donnees (build_dataset) :
  1. Normalisation  — lowercase, strip www., strip espaces/points parasites
  2. Deduplication  — suppression des doublons intra- et inter-sources
  3. Verification   — detection des conflits (domaine present dans les deux classes)
  4. Equilibrage    — echantillonnage ALEATOIRE (seed fixe) jusqu'a max_per_class

  NOTE — deux biais ont ete corriges (cf. rapport, chapitre 4) :

  1. Classe "legitime" trop homogene. Elle ne venait que d'etalab (domaines
     administratifs francais : .fr/.gouv.fr, plusieurs points, noms a tirets).
     Le modele apprenait "administration francaise = legitime" et, par
     contraste, "court, .com, un seul point = jetable" : gmail.com, yahoo.com ou
     outlook.com etaient classes jetables (P > 0,5). La classe legitime est
     donc desormais alimentee a parts egales par etalab ET par les 50 000
     sites les plus populaires (Tranco), dont beaucoup sont de courts .com.
  2. Mot-cle "mail" trouve par sous-chaine. "mail" est dans "gmail",
     "hotmail" ou "protonmail" : la feature has_suspicious_keyword faisait
     passer gmail.com de 0,69 a 0,97. Les mots-cles specifiques (mailinator,
     yopmail...) restent des sous-chaines ; les mots courants (temp, fake,
     trash...) ne comptent que comme MOTS ENTIERS ; "mail" est retire.

  Le sous-echantillonnage equilibre (seed fixe) est conserve : la detection
  exhaustive des domaines jetables CONNUS reste assuree par la blacklist
  MongoDB (poids 0.55, ~190k domaines) ; le ML sert a generaliser sur des
  domaines jamais vus via leurs caracteristiques lexicales, pas a memoriser
  la liste.

  Evaluation : outre le split 80/20, le modele est evalue sur des domaines
  JAMAIS vus a l'entrainement : HOLDOUT_DOMAINS (grandes marques, exclues du
  jeu d'entrainement) et les domaines jetables non echantillonnes.

Importable par app.py :
  from train import extract_features, FEATURE_COLUMNS
"""

import math
import re
import os
import io
import random
import csv
import logging
import urllib.request
from urllib.error import URLError

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.metrics import classification_report, roc_auc_score
import joblib

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTES — partagees avec app.py
# ─────────────────────────────────────────────────────────────────────────────

FEATURE_COLUMNS = [
    "domain_length",
    "name_length",
    "has_digit",
    "digit_ratio",
    "entropy",
    "tld_risk",
    "has_suspicious_keyword",
    "consecutive_consonants",
    "num_dots",
]

# TLD → score de risque (positif = suspect, negatif = de confiance)
TLD_RISK: dict = {
    ".tk": 4, ".ml": 4, ".ga": 4, ".cf": 4, ".gq": 4,
    ".xyz": 3, ".top": 3, ".click": 3, ".loan": 3, ".win": 3,
    ".stream": 3, ".download": 3, ".racing": 3, ".review": 3,
    ".trade": 3, ".webcam": 3, ".faith": 3, ".bid": 3,
    ".party": 3, ".date": 2, ".work": 2, ".science": 2,
    ".io": 0, ".co": 0, ".me": 0,
    ".com": -1, ".net": -1, ".fr": -1, ".de": -1,
    ".org": -2, ".co.uk": -2, ".ac.uk": -2,
    ".edu": -4, ".gov": -4, ".mil": -4,
    ".gouv.fr": -4, ".alsace": -1, ".bzh": -1,
    # ccTLD nationaux payants (enregistrement controle par un registre officiel,
    # contrairement a .tk/.ml/.ga/.cf/.gq ci-dessus qui sont distribues
    # gratuitement par Freenom et tres majoritairement utilises pour l'abus).
    # Meme niveau de confiance que .com/.fr/.de.
    ".tn": -1, ".ma": -1, ".dz": -1, ".sn": -1, ".eg": -1, ".ci": -1,
    ".ke": -1, ".ng": -1, ".za": -1, ".gh": -1, ".rw": -1,
    ".uk": -1, ".es": -1, ".it": -1, ".pt": -1, ".nl": -1, ".be": -1,
    ".ch": -1, ".at": -1, ".se": -1, ".no": -1, ".fi": -1, ".dk": -1,
    ".pl": -1, ".ie": -1, ".gr": -1, ".tr": -1,
    ".ca": -1, ".us": -1, ".mx": -1, ".br": -1, ".ar": -1,
    ".au": -1, ".nz": -1, ".jp": -1, ".kr": -1, ".cn": -1, ".in": -1,
    ".sg": -1, ".my": -1, ".th": -1, ".ae": -1, ".sa": -1, ".qa": -1, ".il": -1,
}

# Mots-cles propres aux services jetables : recherches par SOUS-CHAINE. Assez longs
# et distinctifs pour ne pas apparaitre dans un nom legitime.
DISPOSABLE_BRAND_KEYWORDS = [
    "guerrilla", "mailnull", "sharklasers", "yopmail", "mailinator", "tempmail",
    "throwaway", "disposable", "noemail", "dodgit", "spamgourmet", "mailnesia",
    "trashmail", "throwam", "getairmail", "filzmail", "getnada", "maildrop",
    "spambox", "randommail", "burnermail", "anonymail", "dispostable",
    "fakeinbox", "spamfree", "minutemail",
]

# Mots courants : comptes uniquement comme MOTS ENTIERS (decoupage sur tout ce qui
# n'est pas une lettre). Une sous-chaine ferait de "template.com" ou "spampoubelle" des
# faux positifs. "mail" n'y figure volontairement pas : il est dans gmail, hotmail,
# protonmail, mailfence...
GENERIC_KEYWORDS = {"temp", "tempr", "fake", "trash", "spam", "junk", "discard", "burner"}

# Conserve pour compatibilite : ensemble des mots-cles utilises.
SUSPICIOUS_KEYWORDS = DISPOSABLE_BRAND_KEYWORDS + sorted(GENERIC_KEYWORDS)

# Domaines LEGITIMES bien connus, EXCLUS de l'entrainement : ils servent a mesurer si le
# modele generalise aux grandes marques (aucun ne doit etre classe jetable).
HOLDOUT_DOMAINS = [
    # messageries
    "gmail.com", "yahoo.com", "yahoo.fr", "outlook.com", "hotmail.com", "hotmail.fr",
    "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "protonmail.com",
    "proton.me", "gmx.com", "gmx.net", "zoho.com", "yandex.com", "mail.ru",
    "laposte.net", "orange.fr", "free.fr", "sfr.fr", "wanadoo.fr", "web.de",
    "t-online.de", "fastmail.com", "tutanota.com", "mail.com",
    # grandes marques
    "google.com", "microsoft.com", "apple.com", "amazon.com", "github.com",
    "linkedin.com", "facebook.com", "twitter.com", "netflix.com", "paypal.com",
    "stripe.com", "wikipedia.org", "dropbox.com", "spotify.com", "adobe.com",
    "salesforce.com",
    # enseignement, institutions, medias
    "mit.edu", "stanford.edu", "ox.ac.uk", "europa.eu", "who.int", "usa.gov",
    "lemonde.fr", "bbc.co.uk", "reuters.com",
    # Tunisie
    "ooredoo.tn", "topnet.tn", "tunisietelecom.tn", "poste.tn", "biat.com.tn",
    "horizon-tech.tn",
]

MODEL_PATH = os.getenv("MODEL_PATH", "model/classifier.pkl")

# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def _shannon_entropy(s: str) -> float:
    """Entropie de Shannon.
    Domaine aleatoire (xk2j9q.tk) → entropie elevee (~3.5+).
    Vrai nom (gmail)              → entropie basse   (~2.0).
    """
    if not s:
        return 0.0
    freq: dict = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    n = len(s)
    return -sum((v / n) * math.log2(v / n) for v in freq.values())


def _get_tld(domain: str) -> str:
    """Extrait le TLD, gere les TLDs composes (co.uk, gouv.fr, etc.)."""
    parts = domain.lower().split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "ac", "org", "com", "net", "gouv"):
        return "." + ".".join(parts[-2:])
    if len(parts) >= 2:
        return "." + parts[-1]
    return ""


def _has_suspicious_keyword(domain: str) -> bool:
    """
    Vrai si le domaine contient un mot-cle de service jetable.
      - mots-cles specifiques (mailinator, yopmail...) : sous-chaine ;
      - mots courants (temp, fake, trash...)           : mot entier uniquement.
    Ainsi "gmail.com" ou "template.com" ne sont pas suspects, "temp-mail.org" l'est.
    """
    if any(kw in domain for kw in DISPOSABLE_BRAND_KEYWORDS):
        return True
    tokens = [t for t in re.split(r"[^a-z]+", domain) if t]
    return any(t in GENERIC_KEYWORDS for t in tokens)


def extract_features(domain: str) -> dict:
    """
    Extrait les features ML depuis un nom de domaine.

    Args:
        domain: domaine a analyser (ex: "gmail.com")

    Returns:
        dict avec exactement les cles de FEATURE_COLUMNS
    """
    domain = domain.lower().strip()
    # Supprimer le prefixe www. si present
    if domain.startswith("www."):
        domain = domain[4:]

    parts = domain.split(".")
    name_part = parts[0] if parts else domain

    tld = _get_tld(domain)
    tld_risk_score = TLD_RISK.get(tld, 0)

    has_digit      = int(bool(re.search(r"\d", name_part)))
    digit_ratio    = sum(c.isdigit() for c in name_part) / max(len(name_part), 1)
    has_kw         = int(_has_suspicious_keyword(domain))
    consec_cons    = len(re.findall(r"[bcdfghjklmnpqrstvwxyz]{4,}", name_part))
    num_dots       = domain.count(".")

    # Le tiret est un separateur de mots courant et legitime dans les noms
    # d'entreprise (horizon-tech, mail-guard...) — on ne le compte pas dans
    # la longueur, au meme titre que les points sont deja traites a part
    # (num_dots) plutot que de gonfler domain_length/name_length.
    domain_for_length = domain.replace("-", "")
    name_for_length    = name_part.replace("-", "")

    return {
        "domain_length":          len(domain_for_length),
        "name_length":            len(name_for_length),
        "has_digit":              has_digit,
        "digit_ratio":            round(digit_ratio, 4),
        "entropy":                round(_shannon_entropy(name_part), 4),
        "tld_risk":               tld_risk_score,
        "has_suspicious_keyword": has_kw,
        "consecutive_consonants": consec_cons,
        "num_dots":               num_dots,
    }


# ─────────────────────────────────────────────────────────────────────────────
# TELECHARGEMENT DES DATASETS
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_raw(url: str, timeout: int = 30) -> str:
    """Telecharge le contenu brut d'une URL. Retourne '' si echec."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MailGuard-Trainer/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
        logger.info(f"  Telecharge ({len(content)//1024} KB) : {url}")
        return content
    except (URLError, Exception) as e:
        logger.warning(f"  Echec telechargement {url} : {e}")
        return ""


def _parse_php_array(content: str) -> list:
    """
    Parse un tableau PHP de la forme :
      return [
        'domain.com',
        'other.net',
        ...
      ];
    Extrait toutes les chaines entre quotes simples.
    """
    return re.findall(r"'([a-z0-9.\-]+\.[a-z]{2,})'", content)


def _parse_plaintext(content: str) -> list:
    """Parse un fichier texte brut, un domaine par ligne."""
    return [
        line.strip()
        for line in content.splitlines()
        if line.strip() and not line.startswith("#") and "." in line
    ]


_LOCAL_DATASETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datasets")


def _load_local_datasets() -> list:
    """
    Charge les domaines jetables depuis les fichiers .txt locaux de datasets/
    (un domaine par ligne). Permet d'enrichir la classe jetable avec des
    datasets fournis manuellement, sans dependre de la disponibilite reseau
    des depots GitHub au moment du build.
    """
    domains = []
    if not os.path.isdir(_LOCAL_DATASETS_DIR):
        return domains
    for fname in sorted(os.listdir(_LOCAL_DATASETS_DIR)):
        if not fname.endswith(".txt"):
            continue
        path = os.path.join(_LOCAL_DATASETS_DIR, fname)
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            parsed = _parse_plaintext(f.read())
        if parsed:
            logger.info(f"  [local/{fname}] {len(parsed)} domaines bruts")
            domains.extend(parsed)
    return domains


_LOCAL_LEGIT_DIR = os.path.join(_LOCAL_DATASETS_DIR, "legitimate")


def _load_local_legit() -> dict:
    """
    Charge les domaines LEGITIMES fournis en local (datasets/legitimate/*.txt, un domaine par
    ligne) : une entree {nom_de_fichier: [domaines]} par fichier, pour que l'echantillonnage
    donne le meme poids a chaque source. Instantane Tranco (https://tranco-list.eu) : versionne
    dans le depot, le build ne depend donc pas de la disponibilite du site.
    """
    sources: dict = {}
    if not os.path.isdir(_LOCAL_LEGIT_DIR):
        return sources
    for fname in sorted(os.listdir(_LOCAL_LEGIT_DIR)):
        if not fname.endswith(".txt"):
            continue
        with open(os.path.join(_LOCAL_LEGIT_DIR, fname), "r", encoding="utf-8", errors="ignore") as f:
            parsed = _parse_plaintext(f.read())
        if parsed:
            logger.info(f"  [local/legitimate/{fname}] {len(parsed)} domaines bruts")
            sources[f"local/{fname}"] = parsed
    return sources


def _parse_etalab_csv(content: str) -> list:
    """
    Parse le CSV etalab (domaines organismes secteur public francais).
    Colonnes : name,http_status,https_status,SIREN,type,sources,script
    Extrait la colonne 'name', supprime les prefixes www.
    """
    domains = []
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        name = row.get("name", "").strip().lower()
        if not name or "." not in name:
            continue
        if name.startswith("www."):
            name = name[4:]
        domains.append(name)
    return domains


# ─────────────────────────────────────────────────────────────────────────────
# CONSTRUCTION DU DATASET
# ─────────────────────────────────────────────────────────────────────────────

_DISPOSABLE_SOURCES = [
    {
        # Repo original fourni par StephaneBour, heberge sous Inbox-Master apres transfert
        "url":    "https://raw.githubusercontent.com/Inbox-Master/disposable-email-domains/master/config/domains.php",
        "parser": _parse_php_array,
        "label":  "StephaneBour/Inbox-Master (PHP)",
    },
    {
        "url":    "https://raw.githubusercontent.com/c-dome/temporary-email/main/list.txt",
        "parser": _parse_plaintext,
        "label":  "c-dome (plaintext)",
    },
]

_LEGIT_SOURCES = [
    {
        "url":    "https://raw.githubusercontent.com/etalab/noms-de-domaine-organismes-secteur-public/master/domains.csv",
        "parser": _parse_etalab_csv,
        "label":  "etalab (secteur public FR)",
    },
]

# Fallback si toutes les sources sont inaccessibles (pas de reseau au build)
_DISPOSABLE_FALLBACK = [
    "mailinator.com", "guerrillamail.com", "tempmail.com", "yopmail.com",
    "trashmail.com", "fakeinbox.com", "mailnull.com", "spamgourmet.com",
    "dispostable.com", "maildrop.cc", "sharklasers.com", "grr.la",
    "spam4.me", "getairmail.com", "filzmail.com", "tempr.email",
    "discard.email", "10minutemail.com", "10minutemail.net",
    "throwam.com", "guerrillamail.info", "guerrillamailblock.com",
    "ahem.email", "anonymbox.com", "antispam.de", "binkmail.com",
    "bspamfree.org", "bugmenot.com", "dayrep.com", "deadaddress.com",
    "deadletter.ga", "devnullmail.com", "dingbone.com", "dfgh.net",
    "xk2j9q.tk", "5jk3m.ml", "zp9xt.cf", "m2k4p.ga", "rjx7.gq",
    "temp2023.xyz", "randommailbox.top", "throwaway-email.com",
    "tempemail.net", "tempinbox.com", "temp-mail.org",
    "emailondeck.com", "spambox.us", "trashmail.at", "trashmail.io",
    "getnada.com", "burnermail.io", "spamfree.eu",
    "mail-temporaire.fr", "jetable.fr.nf", "jetable.net", "jetable.org",
    "mailzilla.com", "mailnew.com", "mailmoat.com", "mail4trash.com",
]

_LEGIT_FALLBACK = [
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "protonmail.com", "zoho.com", "aol.com", "live.com", "msn.com",
    "laposte.net", "orange.fr", "free.fr", "sfr.fr", "wanadoo.fr",
    "google.com", "microsoft.com", "apple.com", "amazon.com", "github.com",
    "wikipedia.org", "linkedin.com", "stripe.com", "shopify.com",
    "salesforce.com", "adobe.com", "cloudflare.com", "oracle.com",
    "mit.edu", "stanford.edu", "harvard.edu", "berkeley.edu",
    "ox.ac.uk", "cam.ac.uk", "sorbonne.fr", "insa-lyon.fr",
    "gov.uk", "usa.gov", "europa.eu", "who.int", "gouv.fr",
    "bbc.co.uk", "reuters.com", "lemonde.fr", "lefigaro.fr",
]


# ─────────────────────────────────────────────────────────────────────────────
# PIPELINE DE PREPARATION DES DONNEES
# ─────────────────────────────────────────────────────────────────────────────

def _normalize(domains: list) -> list:
    """
    Etape 1 — Normalisation.
    - Lowercase
    - Suppression du prefixe www.
    - Suppression des espaces, points de debut/fin
    - Filtrage : doit contenir un point et avoir une longueur raisonnable
    """
    normalized = []
    for d in domains:
        d = d.strip().lower()
        d = d.lstrip(".")
        if d.startswith("www."):
            d = d[4:]
        if "." in d and 3 <= len(d) <= 253:
            normalized.append(d)
    return normalized


def _deduplicate(domains: list) -> list:
    """
    Etape 2 — Deduplication.
    Supprime les doublons en preservant l'ordre d'insertion (premier gagne).
    """
    seen = set()
    result = []
    for d in domains:
        if d not in seen:
            seen.add(d)
            result.append(d)
    return result


def _remove_conflicts(disposable: list, legit: list) -> tuple:
    """
    Etape 3 — Verification des labels / suppression des conflits.
    Un domaine present dans les deux listes est ambigu : on le retire des deux.
    Exemple : un domaine public francais pourrait apparaitre par erreur
    dans une liste de jetables.
    """
    set_disp  = set(disposable)
    set_legit = set(legit)
    conflicts = set_disp & set_legit

    if conflicts:
        logger.warning(
            f"  {len(conflicts)} conflit(s) detecte(s) — retires des deux classes : "
            f"{list(conflicts)[:5]}{'...' if len(conflicts) > 5 else ''}"
        )
        disposable = [d for d in disposable if d not in conflicts]
        legit      = [d for d in legit      if d not in conflicts]
    else:
        logger.info("  Aucun conflit detecte entre les deux classes.")

    return disposable, legit


def _balance(disposable: list, legit: list, max_per_class: int, seed: int = 42) -> tuple:
    """
    Etape 4 — Equilibrage des classes.

    Sous-echantillonnage ALEATOIRE (seed fixe pour reproductibilite) de la
    classe majoritaire jusqu'a min(n, max_per_class). Un simple `[:n]` sur
    des listes concatenees depuis plusieurs sources refleterait l'ordre des
    sources plutot qu'un echantillon representatif — d'ou le tirage aleatoire.

    Voir la note en tete de fichier : au-dela d'un certain volume, la classe
    "legitime" (une seule source, domaines administratifs francais) devient
    noyee par la diversite structurelle de la classe "jetable", ce qui fait
    apprendre au modele des faux positifs sur des domaines legitimes tres
    communs (gmail.com, microsoft.com...). max_per_class borne ce risque.
    """
    rng = random.Random(seed)
    n = min(len(disposable), len(legit), max_per_class)
    disposable = rng.sample(disposable, n)
    legit      = rng.sample(legit, n)
    logger.info(f"  Equilibrage final : {n} echantillons par classe (total = {2*n})")
    return disposable, legit


def _stratified_sample(sources: dict, n: int, seed: int = 42) -> list:
    """
    Tire n domaines en donnant le MEME poids a chaque source (tirage a tour de role dans un
    ordre aleatoire a seed fixe). Si une source est trop petite, les autres completent.
    Sans cela, la source la plus volumineuse (etalab, ~72 000 entrees) noierait les autres.
    """
    rng = random.Random(seed)
    pools = {name: rng.sample(items, len(items)) for name, items in sources.items()}
    taken = {name: 0 for name in pools}
    remaining = n
    while remaining > 0:
        progressed = False
        for name, pool in pools.items():
            if remaining > 0 and taken[name] < len(pool):
                taken[name] += 1
                remaining -= 1
                progressed = True
        if not progressed:
            break
    return [d for name, pool in pools.items() for d in pool[:taken[name]]]


def build_dataset(max_per_class: int = 15000, with_extras: bool = False):
    """
    Construit un DataFrame labelise pret a l'entrainement.
    Avec with_extras=True, renvoie aussi (df, extras) ou extras contient les jeux d'evaluation
    JAMAIS vus a l'entrainement : "holdout_legit" (HOLDOUT_DOMAINS) et "unseen_disposable".

    Pipeline :
      1. Collecte   — telechargement depuis toutes les sources
      2. Normalisation
      3. Deduplication
      4. Verification des conflits
      5. Equilibrage
      6. Extraction de features + assemblage du DataFrame
    """
    logger.info("=" * 60)
    logger.info("PIPELINE DE PREPARATION DES DONNEES")
    logger.info("=" * 60)

    # ── Collecte ─────────────────────────────────────────────────────────────
    logger.info("\n[Collecte] Telechargement des sources jetables...")
    raw_disposable: list = []
    for src in _DISPOSABLE_SOURCES:
        content = _fetch_raw(src["url"])
        if content:
            parsed = src["parser"](content)
            logger.info(f"  [{src['label']}] {len(parsed)} domaines bruts")
            raw_disposable.extend(parsed)

    raw_disposable.extend(_load_local_datasets())

    if len(raw_disposable) < 200:
        logger.warning("  Sources jetables indisponibles — fallback active.")
        raw_disposable = _DISPOSABLE_FALLBACK.copy()

    logger.info(f"\n[Collecte] Sources legitimes...")
    legit_sources: dict = {}
    for src in _LEGIT_SOURCES:
        content = _fetch_raw(src["url"])
        if content:
            parsed = src["parser"](content)
            logger.info(f"  [{src['label']}] {len(parsed)} domaines bruts")
            legit_sources[src["label"]] = parsed
    legit_sources.update(_load_local_legit())

    if sum(len(v) for v in legit_sources.values()) < 200:
        logger.warning("  Sources legitimes indisponibles — fallback active.")
        legit_sources = {"fallback": _LEGIT_FALLBACK.copy()}

    logger.info(
        f"\n  Brut collecte : {len(raw_disposable)} jetables | "
        + " + ".join(f"{len(v)} ({k})" for k, v in legit_sources.items())
    )

    # ── Etape 1 : Normalisation ───────────────────────────────────────────────
    logger.info("\n[Etape 1] Normalisation des formats...")
    disposable = _normalize(raw_disposable)
    legit_sources = {name: _normalize(items) for name, items in legit_sources.items()}
    logger.info(
        f"  Apres normalisation : {len(disposable)} jetables | "
        + " + ".join(f"{len(v)} ({k})" for k, v in legit_sources.items())
    )

    # ── Etape 2 : Deduplication ───────────────────────────────────────────────
    logger.info("\n[Etape 2] Deduplication...")
    before_d = len(disposable)
    disposable = _deduplicate(disposable)
    seen_legit: set = set()
    for name in list(legit_sources):
        unique = [d for d in _deduplicate(legit_sources[name]) if d not in seen_legit]   # un domaine appartient a une seule source
        seen_legit.update(unique)
        legit_sources[name] = unique
    logger.info(f"  Supprimes : {before_d - len(disposable)} doublons jetables")
    logger.info(
        f"  Apres dedup : {len(disposable)} jetables | "
        + " + ".join(f"{len(v)} ({k})" for k, v in legit_sources.items())
    )

    # ── Etape 3 : Verification des conflits ───────────────────────────────────
    logger.info("\n[Etape 3] Verification des labels (conflits inter-classes)...")
    all_legit = [d for v in legit_sources.values() for d in v]
    disposable, kept_legit = _remove_conflicts(disposable, all_legit)
    kept = set(kept_legit)
    legit_sources = {name: [d for d in items if d in kept] for name, items in legit_sources.items()}

    # ── Etape 3 bis : mise de cote du jeu d'evaluation ───────────────────────
    holdout = set(HOLDOUT_DOMAINS)
    legit_sources = {name: [d for d in items if d not in holdout] for name, items in legit_sources.items()}
    disposable = [d for d in disposable if d not in holdout]
    logger.info(f"\n[Etape 3 bis] {len(holdout)} domaines de reference exclus de l'entrainement (HOLDOUT_DOMAINS).")

    # ── Etape 4 : Equilibrage ─────────────────────────────────────────────────
    logger.info("\n[Etape 4] Equilibrage des classes (parts egales entre sources legitimes)...")
    n_target = min(len(disposable), sum(len(v) for v in legit_sources.values()), max_per_class)
    legit = _stratified_sample(legit_sources, n_target)
    disposable_all = disposable
    disposable, legit = _balance(disposable, legit, max_per_class)
    legit_set = set(legit)
    for name, items in legit_sources.items():
        used = sum(1 for d in items if d in legit_set)
        logger.info(f"  Source legitime {name} : {used} retenus sur {len(items)} disponibles")

    # ── Extraction de features + assemblage ──────────────────────────────────
    logger.info("\n[Features] Extraction des features...")
    records = []

    for domain in disposable:
        feats = extract_features(domain)
        feats["label"] = 1
        feats["domain"] = domain   # trace pour l'analyse d'erreurs (hors features)
        records.append(feats)

    for domain in legit:
        feats = extract_features(domain)
        feats["label"] = 0
        feats["domain"] = domain   # trace pour l'analyse d'erreurs (hors features)
        records.append(feats)

    df = pd.DataFrame(records)
    logger.info(
        f"\nDataset final : {len(df)} echantillons | "
        f"jetable={int(df['label'].sum())} | "
        f"legitime={int((df['label'] == 0).sum())}"
    )
    logger.info("=" * 60)

    if not with_extras:
        return df
    used = set(disposable)
    unseen = [d for d in disposable_all if d not in used]
    random.Random(7).shuffle(unseen)
    extras = {
        "holdout_legit":     [d for d in HOLDOUT_DOMAINS if d not in set(disposable_all)],
        "unseen_disposable": unseen[:10000],
    }
    return df, extras


# ─────────────────────────────────────────────────────────────────────────────
# ENTRAINEMENT
# ─────────────────────────────────────────────────────────────────────────────

def _proba(model, domains: list) -> np.ndarray:
    """P(jetable) du modele pour une liste de domaines."""
    X = np.array([[extract_features(d)[c] for c in FEATURE_COLUMNS] for d in domains])
    return model.predict_proba(X)[:, 1]


def evaluate_holdouts(model, extras: dict) -> dict:
    """
    Evalue le modele sur des domaines JAMAIS vus a l'entrainement.
      - grandes marques legitimes : aucune ne doit depasser 0,5 ;
      - domaines jetables non echantillonnes : mesure de generalisation (rappel).
    """
    legit_p = _proba(model, extras["holdout_legit"])
    disp_p  = _proba(model, extras["unseen_disposable"]) if extras["unseen_disposable"] else np.array([])
    result = {
        "holdout_n":         len(legit_p),
        "holdout_flagged":   int((legit_p >= 0.5).sum()),
        "holdout_mean":      float(legit_p.mean()),
        "holdout_max":       float(legit_p.max()),
        "unseen_n":          len(disp_p),
        "unseen_recall":     float((disp_p >= 0.5).mean()) if len(disp_p) else float("nan"),
    }
    logger.info("\nEvaluation sur des domaines JAMAIS vus a l'entrainement :")
    logger.info(
        f"  Grandes marques legitimes : {result['holdout_flagged']}/{result['holdout_n']} classees jetables "
        f"(P moyenne {result['holdout_mean']:.3f}, max {result['holdout_max']:.3f})"
    )
    for d, p in sorted(zip(extras["holdout_legit"], legit_p), key=lambda x: -x[1])[:8]:
        logger.info(f"    {d:<22} P(jetable) = {p:.3f}")
    if len(disp_p):
        logger.info(f"  Jetables non echantillonnes : rappel {result['unseen_recall']:.3f} sur {result['unseen_n']} domaines")
    return result

def train_model(df: pd.DataFrame, extras: dict = None) -> RandomForestClassifier:
    """
    Entraine un RandomForestClassifier.

    Choix Random Forest :
      - Simple, robuste, peu sensible aux hyperparametres
      - Bonne calibration des probabilites (essentielle pour score 0-15)
      - Tres efficace sur des features mixtes (binaires + continues)
      - Resistant au surapprentissage grace au bagging
    """
    X = df[FEATURE_COLUMNS].values
    y = df["label"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=5,
        max_features="sqrt",
        class_weight="balanced",   # gere automatiquement les desequilibres residuels
        n_jobs=-1,                  # utilise tous les coeurs disponibles
        random_state=42,
    )

    logger.info("Entrainement RandomForestClassifier...")
    model.fit(X_train, y_train)

    # ── Evaluation ──────────────────────────────────────────────────────────
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    auc    = roc_auc_score(y_test, y_prob)

    logger.info(f"\nROC-AUC : {auc:.4f}")
    logger.info("\n" + classification_report(y_test, y_pred, target_names=["Legitime", "Jetable"]))

    # ── Validation croisee ───────────────────────────────────────────────────
    cv     = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_f1  = cross_val_score(model, X, y, cv=cv, scoring="f1")
    cv_auc = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    logger.info(f"Cross-val F1  : {cv_f1.mean():.3f}  (+/- {cv_f1.std():.3f})")
    logger.info(f"Cross-val AUC : {cv_auc.mean():.3f}  (+/- {cv_auc.std():.3f})")

    # ── Importance des features ───────────────────────────────────────────────
    importances = sorted(
        zip(FEATURE_COLUMNS, model.feature_importances_),
        key=lambda x: x[1], reverse=True,
    )
    logger.info("\nImportance des features :")
    for feat, imp in importances:
        bar = "|" * int(imp * 40)
        logger.info(f"  {feat:<28} {imp:.4f}  {bar}")

    if extras:
        evaluate_holdouts(model, extras)

    return model


# ─────────────────────────────────────────────────────────────────────────────
# SAUVEGARDE
# ─────────────────────────────────────────────────────────────────────────────

def save_model(model: RandomForestClassifier, path: str = MODEL_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    artifact = {
        "model":     model,
        "features":  FEATURE_COLUMNS,
        "version":   "1.1.0",
        "algorithm": "RandomForestClassifier",
    }
    joblib.dump(artifact, path, compress=3)
    size_kb = os.path.getsize(path) // 1024
    logger.info(f"Modele sauvegarde -> {path}  ({size_kb} KB)")


# ─────────────────────────────────────────────────────────────────────────────
# POINT D'ENTREE
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    df, extras = build_dataset(with_extras=True)
    model = train_model(df, extras)
    save_model(model)
    logger.info("Entrainement termine.")
