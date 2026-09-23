"""
Tests unitaires — train.py (ML Classifier)
Couvre : extract_features, pipeline de preparation, parsers, feature engineering.
Aucun appel réseau — toute la logique pure est testée en isolation.
"""

import sys
import os
import math

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from train import (
    extract_features,
    FEATURE_COLUMNS,
    _shannon_entropy,
    _get_tld,
    _normalize,
    _deduplicate,
    _remove_conflicts,
    _balance,
    _parse_php_array,
    _parse_plaintext,
    _parse_etalab_csv,
    _has_suspicious_keyword,
    _stratified_sample,
    _load_local_legit,
    evaluate_holdouts,
    build_dataset,
    HOLDOUT_DOMAINS,
)
import train as train_module


# ─────────────────────────────────────────────────────────────────────────────
# _shannon_entropy()
# ─────────────────────────────────────────────────────────────────────────────

class TestShannonEntropy:

    def test_chaine_vide_retourne_zero(self):
        assert _shannon_entropy("") == 0.0

    def test_un_seul_caractere_retourne_zero(self):
        assert _shannon_entropy("a") == 0.0

    def test_domaine_aleatoire_haute_entropie(self):
        # xk2j9q → caractères variés → entropie élevée
        assert _shannon_entropy("xk2j9q") > 2.5

    def test_mot_simple_basse_entropie(self):
        # gmail → lettres répétées → entropie basse
        assert _shannon_entropy("gmail") < _shannon_entropy("xk2j9q")

    def test_chaine_uniforme_entropie_maximale(self):
        # "abcd" a une entropie plus élevée que "aabc" (moins de répétitions)
        assert _shannon_entropy("abcd") > _shannon_entropy("aabc")


# ─────────────────────────────────────────────────────────────────────────────
# _get_tld()
# ─────────────────────────────────────────────────────────────────────────────

class TestGetTld:

    def test_tld_simple(self):
        assert _get_tld("example.com") == ".com"

    def test_tld_compose_co_uk(self):
        assert _get_tld("example.co.uk") == ".co.uk"

    def test_tld_gouv_fr(self):
        assert _get_tld("service.gouv.fr") == ".gouv.fr"

    def test_tld_tk_suspect(self):
        assert _get_tld("spam.tk") == ".tk"

    def test_pas_de_tld(self):
        assert _get_tld("localhost") == ""


# ─────────────────────────────────────────────────────────────────────────────
# extract_features()
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractFeatures:

    def test_retourne_exactement_les_feature_columns(self):
        feats = extract_features("gmail.com")
        assert set(feats.keys()) == set(FEATURE_COLUMNS)

    def test_domaine_avec_chiffres(self):
        feats = extract_features("0815.ru")
        assert feats["has_digit"] == 1
        assert feats["digit_ratio"] > 0

    def test_domaine_sans_chiffres(self):
        feats = extract_features("gmail.com")
        assert feats["has_digit"] == 0
        assert feats["digit_ratio"] == 0.0

    def test_mot_cle_suspect(self):
        feats = extract_features("tempmail.com")
        assert feats["has_suspicious_keyword"] == 1

    def test_domaine_legitime_pas_suspect(self):
        # google.com ne contient aucun mot-cle suspect
        feats = extract_features("google.com")
        assert feats["has_suspicious_keyword"] == 0

    def test_tld_suspect_score_positif(self):
        feats = extract_features("spam.tk")
        assert feats["tld_risk"] > 0

    def test_tld_edu_score_negatif(self):
        feats = extract_features("mit.edu")
        assert feats["tld_risk"] < 0

    def test_tld_national_legitime_score_negatif(self):
        # ccTLD payant (Tunisie) — meme confiance que .com/.fr, pas neutre
        feats = extract_features("horizon-tech.tn")
        assert feats["tld_risk"] < 0

    def test_tld_freenom_reste_suspect(self):
        # Les TLD gratuits abuses (Freenom) restent a juste titre penalises
        feats = extract_features("horizon-tech.tk")
        assert feats["tld_risk"] > 0

    def test_tiret_ne_gonfle_pas_la_longueur(self):
        # "horizon-tech" (nom d'entreprise legitime a tiret) ne doit pas
        # paraitre plus long que sa version sans tiret "horizontech"
        avec_tiret = extract_features("horizon-tech.com")
        sans_tiret = extract_features("horizontech.com")
        assert avec_tiret["name_length"] == sans_tiret["name_length"]
        assert avec_tiret["domain_length"] == sans_tiret["domain_length"]

    def test_strip_www(self):
        feats1 = extract_features("gmail.com")
        feats2 = extract_features("www.gmail.com")
        assert feats1["domain_length"] == feats2["domain_length"]

    def test_domaine_aleatoire_entropie_elevee(self):
        feats = extract_features("xk2j9qmpl.tk")
        assert feats["entropy"] > 2.5

    def test_toutes_les_valeurs_sont_numeriques(self):
        feats = extract_features("example.com")
        for key, val in feats.items():
            assert isinstance(val, (int, float)), f"{key} doit être numérique"


# ─────────────────────────────────────────────────────────────────────────────
# _normalize()
# ─────────────────────────────────────────────────────────────────────────────

class TestNormalize:

    def test_met_en_minuscules(self):
        result = _normalize(["GMAIL.COM"])
        assert "gmail.com" in result

    def test_supprime_prefixe_www(self):
        result = _normalize(["www.gmail.com"])
        assert "gmail.com" in result
        assert "www.gmail.com" not in result

    def test_supprime_espaces(self):
        result = _normalize(["  gmail.com  "])
        assert "gmail.com" in result

    def test_filtre_domaines_sans_point(self):
        result = _normalize(["localhost", "gmail.com"])
        assert "localhost" not in result
        assert "gmail.com" in result

    def test_filtre_domaines_trop_courts(self):
        result = _normalize(["a.b", "gmail.com"])
        assert "gmail.com" in result

    def test_liste_vide(self):
        assert _normalize([]) == []


# ─────────────────────────────────────────────────────────────────────────────
# _deduplicate()
# ─────────────────────────────────────────────────────────────────────────────

class TestDeduplicate:

    def test_supprime_doublons(self):
        result = _deduplicate(["gmail.com", "gmail.com", "yahoo.com"])
        assert result.count("gmail.com") == 1

    def test_preserve_ordre(self):
        result = _deduplicate(["yahoo.com", "gmail.com", "yahoo.com"])
        assert result[0] == "yahoo.com"
        assert result[1] == "gmail.com"

    def test_liste_sans_doublon_inchangee(self):
        domains = ["gmail.com", "yahoo.com", "outlook.com"]
        assert _deduplicate(domains) == domains

    def test_liste_vide(self):
        assert _deduplicate([]) == []


# ─────────────────────────────────────────────────────────────────────────────
# _remove_conflicts()
# ─────────────────────────────────────────────────────────────────────────────

class TestRemoveConflicts:

    def test_supprime_domaine_present_dans_les_deux_listes(self):
        disposable = ["mailinator.com", "gmail.com"]  # gmail est un conflit
        legit      = ["gmail.com", "yahoo.com"]
        d, l = _remove_conflicts(disposable, legit)
        assert "gmail.com" not in d
        assert "gmail.com" not in l

    def test_conserve_les_domaines_non_conflictuels(self):
        disposable = ["mailinator.com"]
        legit      = ["gmail.com"]
        d, l = _remove_conflicts(disposable, legit)
        assert "mailinator.com" in d
        assert "gmail.com" in l

    def test_sans_conflit_listes_inchangees(self):
        disposable = ["mailinator.com"]
        legit      = ["gmail.com"]
        d, l = _remove_conflicts(disposable, legit)
        assert d == disposable
        assert l == legit

    def test_listes_vides(self):
        d, l = _remove_conflicts([], [])
        assert d == []
        assert l == []


# ─────────────────────────────────────────────────────────────────────────────
# _balance()
# ─────────────────────────────────────────────────────────────────────────────

class TestBalance:

    def test_equilibre_classes_inegales(self):
        disposable = [f"a{i}.com" for i in range(1000)]
        legit      = [f"b{i}.com" for i in range(500)]
        d, l = _balance(disposable, legit, max_per_class=10000)
        assert len(d) == len(l) == 500

    def test_respecte_max_per_class(self):
        disposable = [f"a{i}.com" for i in range(1000)]
        legit      = [f"b{i}.com" for i in range(1000)]
        d, l = _balance(disposable, legit, max_per_class=200)
        assert len(d) == 200
        assert len(l) == 200

    def test_listes_egales_non_modifiees_en_taille(self):
        disposable = ["a.com", "b.com"]
        legit      = ["c.com", "d.com"]
        d, l = _balance(disposable, legit, max_per_class=10)
        assert len(d) == 2
        assert len(l) == 2

    def test_reproductible_avec_seed_fixe(self):
        disposable = [f"a{i}.com" for i in range(1000)]
        legit      = [f"b{i}.com" for i in range(1000)]
        d1, l1 = _balance(disposable, legit, max_per_class=50, seed=42)
        d2, l2 = _balance(disposable, legit, max_per_class=50, seed=42)
        assert d1 == d2
        assert l1 == l2


# ─────────────────────────────────────────────────────────────────────────────
# Parsers
# ─────────────────────────────────────────────────────────────────────────────

class TestParsers:

    def test_parse_php_array_extrait_domaines(self):
        content = "<?php return [\n  'mailinator.com',\n  'guerrillamail.com',\n];"
        result = _parse_php_array(content)
        assert "mailinator.com" in result
        assert "guerrillamail.com" in result

    def test_parse_php_array_ignore_commentaires(self):
        content = "<?php // ceci est un commentaire\nreturn ['mailinator.com'];"
        result = _parse_php_array(content)
        assert "mailinator.com" in result

    def test_parse_plaintext_un_par_ligne(self):
        content = "mailinator.com\nguerrillamail.com\ntempmail.com"
        result = _parse_plaintext(content)
        assert result == ["mailinator.com", "guerrillamail.com", "tempmail.com"]

    def test_parse_plaintext_ignore_commentaires(self):
        content = "# commentaire\nmailinator.com"
        result = _parse_plaintext(content)
        assert "# commentaire" not in result
        assert "mailinator.com" in result

    def test_parse_plaintext_ignore_lignes_vides(self):
        content = "mailinator.com\n\n\nguerrillamail.com"
        result = _parse_plaintext(content)
        assert len(result) == 2

    def test_parse_etalab_csv_extrait_colonne_name(self):
        content = "name,http_status,https_status\ngouv.fr,200,200\nwww.service.fr,200,200"
        result = _parse_etalab_csv(content)
        assert "gouv.fr" in result

    def test_parse_etalab_csv_supprime_www(self):
        content = "name,http_status\nwww.service.fr,200"
        result = _parse_etalab_csv(content)
        assert "service.fr" in result
        assert "www.service.fr" not in result

    def test_parse_etalab_csv_ignore_lignes_sans_point(self):
        content = "name,http_status\nlocalhost,200\ngouv.fr,200"
        result = _parse_etalab_csv(content)
        assert "localhost" not in result
        assert "gouv.fr" in result


# ─────────────────────────────────────────────────────────────────────────────
# Mots-clés : mots entiers pour les mots courants, sous-chaîne pour les marques
# (régression : « mail » était trouvé dans gmail.com et faisait passer sa
# probabilité « jetable » de 0,69 à 0,97)
# ─────────────────────────────────────────────────────────────────────────────

class TestSuspiciousKeyword:

    @pytest.mark.parametrize("domain", [
        "gmail.com", "hotmail.com", "protonmail.com", "mailfence.com", "mailchimp.com",
        "mail.ru", "template.com", "tempo.fr", "contemporary.org", "spamhausx.org",
    ])
    def test_domaines_legitimes_ne_sont_pas_suspects(self, domain):
        assert _has_suspicious_keyword(domain) is False

    @pytest.mark.parametrize("domain", [
        "tempmail.com", "yopmail.fr", "mailinator.com", "guerrillamail.info",
        "10minutemail.net", "temp-mail.org", "trash-mail.com", "fake.inbox.io", "spam.example.com",
    ])
    def test_services_jetables_sont_suspects(self, domain):
        assert _has_suspicious_keyword(domain) is True

    def test_les_chiffres_separent_les_mots(self):
        assert _has_suspicious_keyword("temp123.com") is True

    def test_extract_features_gmail_sans_mot_cle(self):
        assert extract_features("gmail.com")["has_suspicious_keyword"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# _stratified_sample() — parts égales entre sources légitimes
# ─────────────────────────────────────────────────────────────────────────────

class TestStratifiedSample:

    def test_parts_egales_entre_sources(self):
        sources = {"a": [f"a{i}.fr" for i in range(1000)], "b": [f"b{i}.com" for i in range(1000)]}
        out = _stratified_sample(sources, 100)
        assert len(out) == 100
        assert sum(d.startswith("a") for d in out) == 50
        assert sum(d.startswith("b") for d in out) == 50

    def test_une_source_petite_est_completee_par_les_autres(self):
        sources = {"petite": [f"p{i}.fr" for i in range(10)], "grande": [f"g{i}.com" for i in range(1000)]}
        out = _stratified_sample(sources, 100)
        assert len(out) == 100
        assert sum(d.startswith("p") for d in out) == 10

    def test_ne_depasse_pas_le_total_disponible(self):
        out = _stratified_sample({"a": ["a1.fr", "a2.fr"], "b": ["b1.com"]}, 50)
        assert sorted(out) == ["a1.fr", "a2.fr", "b1.com"]

    def test_reproductible_avec_seed_fixe(self):
        sources = {"a": [f"a{i}.fr" for i in range(500)], "b": [f"b{i}.com" for i in range(500)]}
        assert _stratified_sample(sources, 60, seed=42) == _stratified_sample(sources, 60, seed=42)

    def test_sans_doublon(self):
        sources = {"a": [f"a{i}.fr" for i in range(200)], "b": [f"b{i}.com" for i in range(200)]}
        out = _stratified_sample(sources, 150)
        assert len(set(out)) == len(out)


# ─────────────────────────────────────────────────────────────────────────────
# Chargement local des domaines légitimes + jeu d'évaluation mis de côté
# ─────────────────────────────────────────────────────────────────────────────

class TestLocalLegit:

    def test_charge_un_dict_par_fichier(self, tmp_path, monkeypatch):
        (tmp_path / "top.txt").write_text("google.com\nwikipedia.org\n# commentaire\n")
        (tmp_path / "ignore.csv").write_text("x.com\n")
        monkeypatch.setattr(train_module, "_LOCAL_LEGIT_DIR", str(tmp_path))
        result = _load_local_legit()
        assert list(result) == ["local/top.txt"]
        assert result["local/top.txt"] == ["google.com", "wikipedia.org"]

    def test_dossier_absent_donne_dict_vide(self, tmp_path, monkeypatch):
        monkeypatch.setattr(train_module, "_LOCAL_LEGIT_DIR", str(tmp_path / "absent"))
        assert _load_local_legit() == {}


class TestHoldout:

    def test_les_grandes_marques_sont_exclues_de_l_entrainement(self, monkeypatch):
        monkeypatch.setattr(train_module, "_fetch_raw", lambda url, timeout=30: "")
        monkeypatch.setattr(train_module, "_load_local_datasets", lambda: [f"jetable{i}.tk" for i in range(400)])
        monkeypatch.setattr(train_module, "_load_local_legit",
                            lambda: {"local/a.txt": [f"legit{i}.com" for i in range(400)] + ["gmail.com", "yahoo.com"]})
        df, extras = build_dataset(max_per_class=100, with_extras=True)
        assert "gmail.com" not in set(df["domain"])
        assert "gmail.com" in extras["holdout_legit"]
        assert int(df["label"].sum()) == 100 and int((df["label"] == 0).sum()) == 100

    def test_les_jetables_non_echantillonnes_sont_disjoints_de_l_entrainement(self, monkeypatch):
        monkeypatch.setattr(train_module, "_fetch_raw", lambda url, timeout=30: "")
        monkeypatch.setattr(train_module, "_load_local_datasets", lambda: [f"jetable{i}.tk" for i in range(400)])
        monkeypatch.setattr(train_module, "_load_local_legit", lambda: {"local/a.txt": [f"legit{i}.com" for i in range(400)]})
        df, extras = build_dataset(max_per_class=100, with_extras=True)
        assert not set(extras["unseen_disposable"]) & set(df["domain"])
        assert len(extras["unseen_disposable"]) == 300

    def test_evaluate_holdouts_compte_les_faux_positifs(self):
        class Fake:
            def predict_proba(self, X):
                import numpy as np
                # probabilité 0,9 quand has_suspicious_keyword = 1, sinon 0,1
                idx = FEATURE_COLUMNS.index("has_suspicious_keyword")
                p = np.where(X[:, idx] == 1, 0.9, 0.1)
                return np.column_stack([1 - p, p])
        extras = {"holdout_legit": ["gmail.com", "google.com", "tempmail.com"], "unseen_disposable": ["yopmail.fr", "example.tk"]}
        result = evaluate_holdouts(Fake(), extras)
        assert result["holdout_n"] == 3
        assert result["holdout_flagged"] == 1
        assert result["unseen_recall"] == 0.5

    def test_holdout_sans_doublon_ni_domaine_invalide(self):
        assert len(set(HOLDOUT_DOMAINS)) == len(HOLDOUT_DOMAINS)
        assert all("." in d for d in HOLDOUT_DOMAINS)
