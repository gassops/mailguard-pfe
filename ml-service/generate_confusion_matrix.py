"""
generate_confusion_matrix.py — Genere la matrice de confusion REELLE du
modele ML actuellement sauvegarde (model/classifier.pkl), pour le rapport PFE.

Reconstruit le meme dataset et le meme split train/test que train.py (memes
seeds : _balance(seed=42), train_test_split(random_state=42)) pour evaluer le
modele exactement comme lors du dernier entrainement — pas de nouveaux
chiffres inventes, uniquement une visualisation de ce que le modele
sauvegarde produit reellement sur son jeu de test.

Usage :
    python3 generate_confusion_matrix.py
"""

import joblib
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, classification_report, roc_auc_score

import train as t

OUTPUT_PATH = "/home/mg/PFE_Latex/figures/chap5/confusion_matrix_ml.png"

print("Reconstruction du dataset (memes sources, memes seeds que train.py)...")
df = t.build_dataset()

X = df[t.FEATURE_COLUMNS].values
y = df["label"].values

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)

print("Chargement du modele sauvegarde (model/classifier.pkl)...")
artifact = joblib.load(t.MODEL_PATH)
model = artifact["model"]

y_pred = model.predict(X_test)
y_prob = model.predict_proba(X_test)[:, 1]

auc = roc_auc_score(y_test, y_prob)
report = classification_report(y_test, y_pred, target_names=["Legitime", "Jetable"])
cm = confusion_matrix(y_test, y_pred)

print(f"\nROC-AUC (jeu de test, {len(y_test)} echantillons) : {auc:.4f}")
print(report)
print("Matrice de confusion (lignes = reel, colonnes = predit) :")
print(cm)

plt.figure(figsize=(6, 5))
sns.heatmap(
    cm, annot=True, fmt="d", cmap="Blues",
    xticklabels=["Legitime", "Jetable"],
    yticklabels=["Legitime", "Jetable"],
)
plt.xlabel("Predit")
plt.ylabel("Reel")
plt.title(f"Matrice de confusion — RandomForest (AUC-ROC = {auc:.3f})")
plt.tight_layout()
plt.savefig(OUTPUT_PATH, dpi=150)
print(f"\nMatrice sauvegardee -> {OUTPUT_PATH}")
