"""Builds PriceGuard_Model.ipynb (run once after editing the cells below)."""
import json
from pathlib import Path

CELLS = [
    ("md", """# PriceGuard — the model

**A.** Detector trained on 200 simulated markets · **B.** Screening rules on real prices (same as the app) · **C.** Detector on real prices, with a check

Files needed next to this notebook: `priceguard_model.py`, `train_real.py`, `run_summary.csv`, `sticky_summary.csv`, `real_pairs.csv`, `sim_examples.csv`, `sample_prices.csv` (or your own CSV exported with `export_prices.py`)."""),
    ("code", """# In Google Colab: upload the four files when asked. Locally: nothing to do.
try:
    from google.colab import files
    uploaded = files.upload()
except ImportError:
    pass"""),
    ("code", """import pandas as pd, numpy as np, matplotlib.pyplot as plt
import priceguard_model as pg
pd.set_option("display.width", 160)"""),
    ("md", "## A1 · Training data: what collusive and competitive markets look like"),
    ("code", """sim = pd.read_csv("sim_examples.csv")
fig, axes = plt.subplots(1, 2, figsize=(12, 3.5), sharey=True)
for ax, (rid, g) in zip(axes, sim.groupby("run_id")):
    ax.plot(g.t, g.price_0, label="bot 1"); ax.plot(g.t, g.price_1, label="bot 2", alpha=.8)
    ax.set_title(f"{g.label.iloc[0]} · {rid}"); ax.set_xlabel("period"); ax.grid(alpha=.3)
axes[0].set_ylabel("price"); axes[0].legend(); plt.tight_layout(); plt.show()"""),
    ("code", """train = pg.load_training()
print(train.label.value_counts().to_string())
train[pg.DETECTOR_FEATURES].describe().T[["mean", "min", "max"]].round(3)"""),
    ("md", "## A2 · Train and evaluate the detector"),
    ("code", """ev = pg.evaluate(train)
print(f"5-fold cross-validated AUC  {ev['cv_auc']:.3f}")
print(f"5-fold cross-validated acc  {ev['cv_accuracy']:.0%}")
print(f"Train Q-learning -> test rule-based  AUC {ev['train Q-learning -> test rule-based']:.3f}")
print(f"Train rule-based -> test Q-learning  AUC {ev['train rule-based -> test Q-learning']:.3f}")"""),
    ("code", """from sklearn.metrics import roc_curve, confusion_matrix
fpr, tpr, _ = roc_curve(train.y, ev["cv_prob"])
fig, (a, b) = plt.subplots(1, 2, figsize=(10, 4))
a.plot(fpr, tpr, lw=2); a.plot([0, 1], [0, 1], "--", c="grey"); a.set_title(f"ROC · AUC {ev['cv_auc']:.3f}")
a.set_xlabel("false positive rate"); a.set_ylabel("true positive rate"); a.grid(alpha=.3)
cm = confusion_matrix(train.y, ev["cv_prob"] >= .5)
b.imshow(cm, cmap="Blues"); b.set_xticks([0, 1], ["competitive", "collusive"]); b.set_yticks([0, 1], ["competitive", "collusive"])
for i in range(2):
    for j in range(2): b.text(j, i, cm[i, j], ha="center", va="center", fontsize=14)
b.set_xlabel("predicted"); b.set_ylabel("actual"); b.set_title("confusion matrix (cross-validated)")
plt.tight_layout(); plt.show()"""),
    ("code", """model = pg.train(train)
coef = pd.Series(model[-1].coef_[0], index=pg.DETECTOR_FEATURES).sort_values()
coef.plot.barh(figsize=(7, 5), title="feature weights (standardised)"); plt.grid(alpha=.3); plt.tight_layout(); plt.show()"""),
    ("md", "## B · Real prices: screening rules (identical to the PriceGuard app)"),
    ("code", """prices = pg.load_prices("sample_prices.csv")   # or your own CSV from the app
pg.plot_prices(prices, "real prices · first column = your product"); plt.show()
prices.tail()"""),
    ("code", """result = pg.report(prices)   # verdicts: screening rules"""),
    ("md", "## C · Why the detector's score is not used on real prices"),
    ("code", """real_feats = []
daily = prices.resample("D").last().ffill(); me = daily.columns[0]
for c in daily.columns[1:]:
    real_feats.append(pg.extract_features(daily[me].to_numpy(), daily[c].to_numpy()))
real = pd.DataFrame(real_feats)
cmp = pd.DataFrame({
    "simulated competitive": train[train.y == 0][["change_freq", "autocorr1", "sync_change_rate"]].mean(),
    "simulated collusive": train[train.y == 1][["change_freq", "autocorr1", "sync_change_rate"]].mean(),
    "this real file": real[["change_freq", "autocorr1", "sync_change_rate"]].mean(),
}).round(3)
cmp"""),
    ("md", "## C1 + C2 · Two attempts to make ML work on real prices"),
    ("code", """models = pg.RealPriceModels()   # needs sticky_summary.csv, real_pairs.csv, train_real.py
print(f"C1 sticky-simulation detector: CV AUC {models.sticky_auc:.3f} on simulated markets")
print(f"C2 real-data model (rival vs unrelated pairs): CV AUC {models.real_auc:.3f}")
_ = pg.report(prices, models, show_ml=True)"""),
]


def cell(kind, src):
    lines = src.split("\n")
    body = [l + "\n" for l in lines[:-1]] + [lines[-1]]
    if kind == "md":
        return {"cell_type": "markdown", "metadata": {}, "source": body}
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": body}


nb = {"cells": [cell(k, s) for k, s in CELLS], "metadata": {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
out = Path(__file__).with_name("PriceGuard_Model.ipynb")
out.write_text(json.dumps(nb, indent=1), encoding="utf-8")
print(out)
