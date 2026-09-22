# -*- coding: utf-8 -*-
"""GSL grubu (4 takım, çift eleme) için Fextopus olasılıkları — TAM hesap, simülasyon yok.

Akış: açılış-1 (A–B) ve açılış-2 (C–D) → kazananlar maçı (iki galip; kazanan 1. sıra)
       ve elenme maçı (iki mağlup; kaybeden elenir) → belirleyici maç (kazananlar
       maçının kaybedeni – elenme maçının galibi; kazanan 2. sıra).
5 maçın 2^5 = 32 sonucu tek tek toplanır.

p(x, y): x'in y'yi yenme olasılığı (Fextopus Elo). Maçlar birbirinden bağımsız
varsayılır — Elo'nun kendi varsayımı; turnuva içi form değişimini hesaba katmaz.
"""
from itertools import product


def gsl_olasiliklari(acilis1, acilis2, p):
    """Döner: {takım: {'birinci': .., 'ikinci': .., 'cikar': ..}} (0..1)."""
    a, b = acilis1
    c, d = acilis2
    sonuc = {t: {'birinci': 0.0, 'ikinci': 0.0} for t in (a, b, c, d)}
    for o1, o2, wm, em, dm in product((0, 1), repeat=5):
        w1, l1 = (a, b) if o1 == 0 else (b, a)
        w2, l2 = (c, d) if o2 == 0 else (d, c)
        pr = (p(w1, l1)) * (p(w2, l2))
        q1, lw = (w1, w2) if wm == 0 else (w2, w1)        # kazananlar maçı
        pr *= p(q1, lw)
        e, _elenen = (l1, l2) if em == 0 else (l2, l1)     # elenme maçı
        pr *= p(e, _elenen)
        q2, _ = (lw, e) if dm == 0 else (e, lw)            # belirleyici
        pr *= p(q2, _)
        sonuc[q1]['birinci'] += pr
        sonuc[q2]['ikinci'] += pr
    for t in sonuc:
        sonuc[t]['cikar'] = sonuc[t]['birinci'] + sonuc[t]['ikinci']
    return sonuc
