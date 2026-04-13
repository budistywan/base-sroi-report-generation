# Prompt untuk Chat Baru
## Melengkapi Canonical JSON Program SROI (PSN / ESD / ETB / ESS / ESP)

---

## Konteks

Saya sedang mengerjakan pipeline produksi laporan SROI TJSL PT Pertamina Lubricants.
Pipeline ini sudah berjalan penuh untuk program **ESL** dan **EHS**.

Untuk menjalankan program lain, dibutuhkan satu file input:
**`canonical_{program}_v1.json`**

File ini adalah bahan baku pipeline. Semua narasi, kalkulasi, dan output Word doc bersumber dari sini.

---

## File yang akan saya lampirkan

1. **`TJSL_Scripts.md`** — berisi batch script pptxgenjs semua program:
   - PSN (psn_batch1/2/3)
   - ESD (esd_batch1/2/3)
   - ETB (etb_batch1/2/3)
   - ESS (ess_batch1/2/3)
   - ESP (esp_batch1/2/3)

2. **`canonical_validator.js`** — validator client-side yang akan mengecek canonical JSON sebelum di-push ke pipeline

3. **`canonical_ehs_v1.json`** — canonical EHS yang sudah selesai, sebagai referensi format

---

## Tugas

Untuk setiap program yang saya minta, bantu saya membuat `canonical_{program}_v1.json` yang siap dijalankan pipeline.

Mulai dari **satu program dulu** yang saya tentukan, baru lanjut ke program berikutnya.

---

## Schema canonical — field yang wajib diisi

### TIER 1 — Wajib untuk pipeline berjalan (akan divalidasi oleh canonical_validator.js)

| Field | Keterangan |
|-------|-----------|
| `schema_version` | "1.0" |
| `case_id` | format: `{program_lower}_2023_2025_v1` |
| `program_identity` | nama, kode, periode, node, kelompok sasaran |
| `source_registry` | minimal 1 sumber |
| `investment` | **flat list per tahun** — lihat format di bawah |
| `outcomes` | daftar outcome + `source_refs` untuk yang proxy |
| `monetization` | **flat list per tahun per aspek** — lihat format di bawah |
| `ddat_params` | per aspek dengan `net_multiplier` + `justification` |
| `ori_rates` | sudah baku: 2023/2024/2025 dengan compound factor |
| `sroi_metrics` | isi 0 — dihitung otomatis pipeline |
| `coverage_status` | semua bab, `bab_7` **harus "strong"** |

### TIER 2 — Penting untuk narasi bab 1–6, 8–9

| Field | Keterangan |
|-------|-----------|
| `activities` | kegiatan per tahun |
| `stakeholders` | dengan `involvement_type` |
| `context_baseline` | kondisi awal |
| `ideal_conditions` | kondisi ideal |
| `strategy_design` | `institutional` **harus object** `{nodes, note}` — bukan string |
| `learning_signals` | loop_1, loop_2, loop_3 |

---

## Format field kritis (WAJIB diikuti persis)

### monetization — flat per tahun
```json
{
  "monetization_id": "MON_PSN_LUB_2023",
  "aspect_id": "MON_PSN_LUB",
  "aspect_code": "LUB",
  "year": 2023,
  "gross_idr": 150000000,
  "proxy_basis": "nilai penjualan pelumas per tahun",
  "data_status": "under_confirmation",
  "measurement_type": "observed",
  "related_outcome_id": "OC_PSN_ECO_01",
  "display_status": "present_as_final"
}
```
**Penting:** `display_status` wajib ada. Nilai yang valid:
`present_as_final` | `present_as_proxy` | `present_as_pending` | `not_applicable`

### investment — flat per tahun
```json
{
  "year": 2023,
  "category": "Program PSN — Total",
  "amount_idr": 500000000,
  "description": "Total anggaran PSN 2023",
  "data_status": "planned"
}
```

### ddat_params — per aspek
```json
{
  "LUB": {
    "deadweight": 0.20,
    "displacement": 0.05,
    "attribution": 0.25,
    "drop_off": 0.05,
    "net_multiplier": 0.5415,
    "notes": "penjelasan singkat per faktor",
    "justification": "Mengapa nilai ini masuk akal untuk program ini"
  }
}
```

### strategy_design.institutional — HARUS object, bukan string
```json
{
  "institutional": {
    "nodes": ["Node A", "Node B", "Node C"],
    "note": "Catatan tentang distribusi node"
  }
}
```

### ori_rates — sudah baku, gunakan ini
```json
{
  "2023": { "series": "ORI023T3", "rate": 0.059,  "compound_factor": 1.1252 },
  "2024": { "series": "ORI025T3", "rate": 0.0625, "compound_factor": 1.0625 },
  "2025": { "series": "ORI027T3", "rate": 0.065,  "compound_factor": 1.0 }
}
```

### coverage_status — bab_7 WAJIB "strong"
```json
{
  "bab_1": "strong",
  "bab_2": "strong",
  "bab_3": "strong",
  "bab_4": "strong",
  "bab_5": "strong",
  "bab_6": "strong",
  "bab_7": "strong",
  "bab_8": "partial",
  "bab_9": "partial"
}
```

### sroi_metrics — WAJIB format ini (bukan flat)
```json
{
  "status": "pending",
  "calculated": {
    "sroi_blended": 0,
    "per_year": [],
    "total_investment": 0,
    "total_gross": 0,
    "total_net": 0,
    "total_net_compounded": 0
  },
  "note": "Dihitung otomatis oleh pipeline"
}
```
⚠️ Jangan gunakan format flat seperti `{"blended_sroi": 0, "sroi_2023": 0, ...}` — financial engine akan crash.

### activities — gunakan format array (bukan dict per tahun)
```json
[
  { "year": 2023, "name": "Pelatihan teknis mesin kapal", "activity_scope": ["Pelatihan teknis mesin kapal"] },
  { "year": 2024, "name": "Aktivasi penjualan pelumas", "activity_scope": ["Aktivasi penjualan pelumas"] }
]
```
Format dict per tahun `{"2023": [...]}` juga bisa diterima pipeline tapi tidak direkomendasikan.

### outcomes — proxy WAJIB punya source_refs
```json
{
  "outcome_id": "OC_PSN_SOC_01",
  "name": "Nelayan lebih terampil merawat mesin",
  "description": "...",
  "measurement": "...",
  "data_status": "proxy",
  "source_refs": ["evidence_registry"]
}
```

---

## Cara validasi setelah selesai

Setelah canonical JSON selesai dibuat, jalankan validasi dengan:

```javascript
// Di browser console atau Node.js
const result = CanonicalValidator.validate(JSON.stringify(canonical), "PSN");
console.log(result.valid, result.errors, result.warnings);
```

File `canonical_validator.js` sudah diupload — validator ini mengecek:
- **Layer 1 (Structural)**: field wajib, tipe array/object yang benar
- **Layer 2 (Schema Contract)**: format monetization, ddat justification, institutional shape, dll
- **Layer 3 (Data Quality)**: placeholder, all-zero, empty arrays

Target: `result.valid === true` dan `result.errors.length === 0`

---

## Cara membaca TJSL_Scripts.md

File ini berisi batch script JavaScript untuk membuat slide PPTX. Data program tersimpan dalam:
- Teks slide (nama program, deskripsi, angka investasi, angka SROI)
- Stat pills dan metric cards (angka kunci)
- Tabel-tabel di slide (breakdown investasi, outcome, dll)

Baca script dengan cermat untuk mengekstrak:
- Nama program dan tagline
- Total investasi per tahun
- Aspek monetisasi dan gross values
- SROI ratio yang tercantum
- Node/lokasi program
- Kelompok sasaran

---

## Program yang ada di TJSL_Scripts.md

| Program | Kode | Batch |
|---------|------|-------|
| Pertamina Sahabat Nelayan | PSN | psn_batch1/2/3 |
| Enduro Sahabat Difabel | ESD | esd_batch1/2/3 |
| Enduro Teman Bengkel | ETB | etb_batch1/2/3 |
| Enduro Sahabat Sekolah | ESS | ess_batch1/2/3 |
| Enduro Sahabat Petani | ESP | esp_batch1/2/3 |

---

## Lesson learned dari PSN (hindari di program berikutnya)

| Masalah | Penyebab | Fix |
|---------|----------|-----|
| Financial engine crash | `sroi_metrics` format flat | Gunakan format `{status, calculated, note}` |
| Point builder crash | `coverage_status.bab_7` missing | Pastikan ada dan bernilai `"strong"` |
| QA Checker C4 fail | `outcomes` proxy tanpa `source_refs` | Tambahkan `source_refs: ["evidence_registry"]` |
| Renderer output ESL | `activities` format dict per tahun | Gunakan format array of objects |
| Narrative crash | `strategy_design.institutional` string | Harus object `{nodes, note}` |

---

## Yang perlu dikonfirmasi sebelum mulai

Program mana yang ingin dikerjakan **pertama**?

Setelah memilih program, saya akan:
1. Membaca section yang relevan dari TJSL_Scripts.md
2. Mengekstrak semua data yang tersedia
3. Membuatkan canonical JSON lengkap
4. Menjalankan validator untuk memastikan tidak ada error
5. Menghasilkan file `canonical_{program}_v1.json` yang siap di-push ke pipeline
