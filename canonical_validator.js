/**
 * canonical_validator.js
 * SROI Report System — Canonical JSON Validator
 *
 * Client-side gate sebelum canonical JSON di-push ke pipeline.
 * Tiga lapisan validasi: Structural → Schema Contract → Data Quality
 *
 * Usage:
 *   const result = CanonicalValidator.validate(jsonString, programCode, options)
 *
 * v1.0.0 — spec by Claude + GPT, April 2026
 */

// ── CONSTANTS ────────────────────────────────────────────────

const ROOT_REQUIRED_FIELDS = [
  'schema_version', 'case_id', 'program_identity',
  'source_registry', 'investment', 'outcomes',
  'monetization', 'ddat_params', 'ori_rates',
  'sroi_metrics', 'coverage_status'
];

const REQUIRED_ARRAY_FIELDS  = ['source_registry', 'investment', 'outcomes', 'monetization'];
const REQUIRED_OBJECT_FIELDS = ['program_identity', 'ddat_params', 'ori_rates', 'sroi_metrics'];
const REQUIRED_SCALAR_FIELDS = ['schema_version', 'case_id'];

const MONETIZATION_REQUIRED_FIELDS = ['aspect_code', 'year', 'gross_idr', 'display_status'];
const INVESTMENT_REQUIRED_FIELDS   = ['year', 'amount_idr'];
const DDAT_REQUIRED_FIELDS         = ['net_multiplier', 'justification'];

const DISPLAY_STATUS_ENUM = [
  'present_as_final', 'present_as_proxy', 'present_as_pending',
  'present_as_inferred', 'not_applicable'
];

const KNOWN_ROOT_FIELDS = [
  ...ROOT_REQUIRED_FIELDS,
  'program_positioning', 'context_baseline', 'problem_framing',
  'ideal_conditions', 'strategy_design', 'activities', 'outputs',
  'stakeholders', 'beneficiaries', 'learning_signals',
  'evidence_registry', 'uncertainty_flags', 'created_at',
  'last_updated', 'data_status', '_submit_ts'
];

const PROGRAM_NAMES = {
  EHS: 'Enduro Home Service',
  ESL: 'Enduro Sahabat Lapas',
  ESD: 'Enduro Sahabat Difabel',
  ESP: 'Enduro Sahabat Petani',
  ESS: 'Enduro Sahabat Sekolah',
  ETB: 'Enduro Teman Bengkel',
  PSN: 'Pertamina Sahabat Nelayan',
};

// ── MAIN CLASS ───────────────────────────────────────────────

class CanonicalValidator {

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  static validate(jsonString, programCode, options = {}) {
    const opts = {
      mode:                 options.mode                 || 'submit',
      expectedYears:        options.expectedYears        || [2023, 2024, 2025],
      filenameProgramCode:  options.filenameProgramCode  || null,
      failOnCoverageBab7:   options.failOnCoverageBab7 !== false,
    };

    const ctx = this._buildContext(jsonString, programCode, opts);
    const bag = { errors: [], warnings: [], infos: [] };

    // Layer 1 — Structural
    this._validateStructural(ctx, bag);

    // Hentikan jika parse/root gagal — layer berikutnya tidak bisa jalan
    const fatalCodes = ['E001', 'E002'];
    if (bag.errors.some(e => fatalCodes.includes(e.code))) {
      this._sortIssues(bag);
      return this._finalize(ctx, bag);
    }

    // Layer 2 — Schema Contract
    this._validateSchemaContract(ctx, bag);

    // Layer 3 — Data Quality
    this._validateDataQuality(ctx, bag);

    this._sortIssues(bag);
    return this._finalize(ctx, bag);
  }

  // ═══════════════════════════════════════════════════════════
  // CONTEXT & PARSE
  // ═══════════════════════════════════════════════════════════

  static _buildContext(jsonString, programCode, opts) {
    const { parsed, error } = this._safeParse(jsonString);
    return {
      raw:                   jsonString,
      parsed,
      parse_error:           error,
      program_code_selected: (programCode || '').toUpperCase(),
      program_code_filename: opts.filenameProgramCode,
      expected_years:        opts.expectedYears,
      options:               opts,
    };
  }

  static _safeParse(jsonString) {
    try {
      return { parsed: JSON.parse(jsonString), error: null };
    } catch(e) {
      return { parsed: null, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LAYER 1 — STRUCTURAL
  // ═══════════════════════════════════════════════════════════

  static _validateStructural(ctx, bag) {
    const { parsed, parse_error } = ctx;

    // E001 — JSON parseable
    if (parse_error) {
      this._push(bag, 'error', {
        code: 'E001', layer: 1, category: 'structural',
        field: 'root', path_type: 'synthetic',
        message: 'Format JSON tidak valid.',
        why_it_matters: 'File tidak bisa dibaca oleh validator maupun pipeline.',
        action: 'Periksa tanda koma, kutip, dan kurung kurawal pada JSON.',
        actual: parse_error, expected: 'valid JSON string',
      });
      return;
    }

    // E002 — Root must be plain object
    if (!this._isPlainObject(parsed)) {
      this._push(bag, 'error', {
        code: 'E002', layer: 1, category: 'structural',
        field: 'root', path_type: 'synthetic',
        message: 'Root JSON harus berupa object {}.',
        why_it_matters: 'Pipeline mengharapkan object di root, bukan array atau nilai lain.',
        action: 'Pastikan JSON diawali dengan { dan diakhiri dengan }.',
        actual: Array.isArray(parsed) ? 'array' : typeof parsed,
        expected: 'plain object',
      });
      return;
    }

    // E003 — Tier 1 required fields
    ROOT_REQUIRED_FIELDS.forEach(f => {
      if (!(f in parsed)) {
        this._push(bag, 'error', {
          code: 'E003', layer: 1, category: 'structural',
          field: f, path_type: 'exact',
          message: `Field wajib '${f}' tidak ditemukan.`,
          why_it_matters: 'Pipeline membutuhkan seluruh field Tier 1 untuk kalkulasi dan narasi.',
          action: `Tambahkan field '${f}' ke root canonical JSON.`,
        });
      }
    });

    // E004 — Required array fields must be arrays
    REQUIRED_ARRAY_FIELDS.forEach(f => {
      if (f in parsed && !Array.isArray(parsed[f])) {
        this._push(bag, 'error', {
          code: 'E004', layer: 1, category: 'structural',
          field: f, path_type: 'exact',
          message: `Field '${f}' harus berupa array.`,
          why_it_matters: 'Pipeline mengiterasi field ini — harus berupa daftar.',
          action: `Ubah '${f}' menjadi array []. Contoh: "${f}": [...]`,
          actual: typeof parsed[f], expected: 'array',
        });
      }
    });

    // E005 — Required object fields must be objects
    REQUIRED_OBJECT_FIELDS.forEach(f => {
      if (f in parsed && (!this._isPlainObject(parsed[f]) || Array.isArray(parsed[f]))) {
        this._push(bag, 'error', {
          code: 'E005', layer: 1, category: 'structural',
          field: f, path_type: 'exact',
          message: `Field '${f}' harus berupa object.`,
          why_it_matters: 'Pipeline mengakses key di dalam field ini.',
          action: `Ubah '${f}' menjadi object {}. Contoh: "${f}": {...}`,
          actual: Array.isArray(parsed[f]) ? 'array' : typeof parsed[f],
          expected: 'plain object',
        });
      }
    });

    // E006 — Required scalar fields must not be blank
    REQUIRED_SCALAR_FIELDS.forEach(f => {
      if (f in parsed && parsed[f] === '') {
        this._push(bag, 'error', {
          code: 'E006', layer: 1, category: 'structural',
          field: f, path_type: 'exact',
          message: `Field '${f}' tidak boleh kosong.`,
          why_it_matters: 'String kosong diperlakukan setara dengan field yang tidak ada.',
          action: `Isi '${f}' dengan nilai yang sesuai.`,
          actual: '""', expected: 'non-empty string',
        });
      }
    });

    // E007 — Unknown root fields (warning ringan)
    if (this._isPlainObject(parsed)) {
      Object.keys(parsed).forEach(k => {
        if (!KNOWN_ROOT_FIELDS.includes(k)) {
          this._push(bag, 'warning', {
            code: 'E007', layer: 1, category: 'structural',
            field: k, path_type: 'exact',
            message: `Field '${k}' tidak dikenal di schema canonical v1.`,
            why_it_matters: 'Kemungkinan typo atau field dari versi schema yang berbeda.',
            action: `Periksa apakah '${k}' memang disengaja atau typo dari field lain.`,
          });
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LAYER 2 — SCHEMA CONTRACT
  // ═══════════════════════════════════════════════════════════

  static _validateSchemaContract(ctx, bag) {
    const p = ctx.parsed;

    // E101 — Monetization entry required fields
    if (Array.isArray(p.monetization)) {
      p.monetization.forEach((m, i) => {
        MONETIZATION_REQUIRED_FIELDS.forEach(f => {
          if (!(f in m) || m[f] === '' || m[f] === null || m[f] === undefined) {
            this._push(bag, 'error', {
              code: 'E101', layer: 2, category: 'schema_contract',
              field: `monetization[${i}].${f}`, path_type: 'exact',
              message: `Field wajib '${f}' tidak ada di monetization entri ke-${i+1}.`,
              why_it_matters: 'Pipeline membutuhkan field ini untuk kalkulasi dan tampilan monetisasi.',
              action: `Tambahkan '${f}' pada monetization[${i}].`,
              expected: 'non-empty value',
            });
          }
        });

        // E114 — display_status enum
        if (m.display_status && !DISPLAY_STATUS_ENUM.includes(m.display_status)) {
          this._push(bag, 'error', {
            code: 'E114', layer: 2, category: 'schema_contract',
            field: `monetization[${i}].display_status`, path_type: 'exact',
            message: `Nilai display_status '${m.display_status}' tidak dikenal.`,
            why_it_matters: 'Renderer hanya memproses nilai display_status yang dikenal.',
            action: `Ganti dengan salah satu: ${DISPLAY_STATUS_ENUM.join(', ')}.`,
            actual: m.display_status, expected: DISPLAY_STATUS_ENUM.join(' | '),
          });
        }

        // E109 — gross_idr must be numeric
        if ('gross_idr' in m && !this._isFiniteNumber(m.gross_idr)) {
          this._push(bag, 'error', {
            code: 'E109', layer: 2, category: 'schema_contract',
            field: `monetization[${i}].gross_idr`, path_type: 'exact',
            message: `Nilai gross_idr harus berupa angka.`,
            why_it_matters: 'Financial engine tidak bisa menghitung dengan nilai non-numerik.',
            action: `Ubah gross_idr menjadi angka, misalnya: 286212494`,
            actual: typeof m.gross_idr, expected: 'finite number',
          });
        }

        // E110 — year must be in expected years
        if ('year' in m && !ctx.expected_years.includes(Number(m.year))) {
          this._push(bag, 'error', {
            code: 'E110', layer: 2, category: 'schema_contract',
            field: `monetization[${i}].year`, path_type: 'exact',
            message: `Tahun ${m.year} di luar rentang yang diharapkan.`,
            why_it_matters: 'Pipeline hanya memproses tahun yang ada di periode program.',
            action: `Gunakan salah satu tahun: ${ctx.expected_years.join(', ')}.`,
            actual: m.year, expected: ctx.expected_years.join(' | '),
          });
        }
      });

      // E111 — Duplicate monetization key (aspect_code + year)
      const monKeys = {};
      p.monetization.forEach((m, i) => {
        if (m.aspect_code && m.year) {
          const key = `${m.aspect_code}|${m.year}`;
          if (monKeys[key] !== undefined) {
            this._push(bag, 'error', {
              code: 'E111', layer: 2, category: 'schema_contract',
              field: `monetization[${i}]`, path_type: 'exact',
              message: `Duplikat monetization: ${m.aspect_code} tahun ${m.year}.`,
              why_it_matters: 'Duplikat akan membuat agregasi nilai salah.',
              action: `Hapus salah satu entri monetization[${monKeys[key]}] atau monetization[${i}].`,
            });
          } else {
            monKeys[key] = i;
          }
        }
      });
    }

    // E102 — ddat_params aspect contract
    if (this._isPlainObject(p.ddat_params)) {
      Object.entries(p.ddat_params).forEach(([asp, val]) => {
        DDAT_REQUIRED_FIELDS.forEach(f => {
          if (!this._isPlainObject(val) || !(f in val) || val[f] === '' || val[f] === null) {
            this._push(bag, 'error', {
              code: 'E102', layer: 2, category: 'schema_contract',
              field: `ddat_params.${asp}.${f}`, path_type: 'exact',
              message: `Field '${f}' wajib ada di ddat_params.${asp}.`,
              why_it_matters: f === 'justification'
                ? 'Tanpa justification, QA Checker C4 akan gagal dan render tidak bisa jalan.'
                : 'Pipeline membutuhkan net_multiplier untuk kalkulasi nilai bersih.',
              action: `Tambahkan '${f}' pada ddat_params.${asp}.`,
            });
          }
        });

        // E109 — net_multiplier numeric
        if (val && 'net_multiplier' in val && !this._isFiniteNumber(val.net_multiplier)) {
          this._push(bag, 'error', {
            code: 'E109', layer: 2, category: 'schema_contract',
            field: `ddat_params.${asp}.net_multiplier`, path_type: 'exact',
            message: `net_multiplier di ddat_params.${asp} harus berupa angka.`,
            why_it_matters: 'Financial engine mengalikan gross value dengan net_multiplier.',
            action: `Ubah net_multiplier menjadi angka desimal, misalnya: 0.6137`,
            actual: typeof val.net_multiplier, expected: 'finite number',
          });
        }
      });
    }

    // E103 — strategy_design.institutional shape
    const inst = p.strategy_design?.institutional;
    if (inst !== undefined) {
      if (typeof inst === 'string') {
        this._push(bag, 'error', {
          code: 'E103', layer: 2, category: 'schema_contract',
          field: 'strategy_design.institutional', path_type: 'exact',
          message: 'Field institutional harus berupa object, bukan string.',
          why_it_matters: 'Point builder mengakses institutional.nodes dan institutional.note — akan crash jika string.',
          action: 'Ubah menjadi: "institutional": { "nodes": [...], "note": "..." }',
          actual: 'string', expected: 'object { nodes, note }',
          example_fix: { nodes: ['Node A', 'Node B'], note: 'Catatan node' },
        });
      } else if (this._isPlainObject(inst)) {
        if (!Array.isArray(inst.nodes)) {
          this._push(bag, 'error', {
            code: 'E103', layer: 2, category: 'schema_contract',
            field: 'strategy_design.institutional.nodes', path_type: 'exact',
            message: 'institutional.nodes harus berupa array.',
            why_it_matters: 'Point builder mengiterasi nodes untuk menyusun argumen 7.1.',
            action: 'Tambahkan "nodes": ["Node A", "Node B", ...] di dalam institutional.',
          });
        }
      }
    }

    // E104 — Proxy outcome must have non-empty source_refs
    if (Array.isArray(p.outcomes)) {
      p.outcomes.forEach((oc, i) => {
        const isProxy = oc.data_status !== 'observed';
        const sr = oc.source_refs;
        if (isProxy && (!Array.isArray(sr) || sr.length === 0)) {
          this._push(bag, 'error', {
            code: 'E104', layer: 2, category: 'schema_contract',
            field: `outcomes[${i}].source_refs`, path_type: 'exact',
            message: `Outcome proxy '${oc.name || oc.outcome_id || i}' harus punya source_refs.`,
            why_it_matters: 'QA Checker C4 mensyaratkan setiap block proxy punya source_refs agar render tidak gagal.',
            action: `Tambahkan source_refs: ["evidence_registry"] pada outcomes[${i}].`,
            example_fix: { source_refs: ['evidence_registry'] },
          });
        }
      });
    }

    // E105 — Investment entry required fields
    if (Array.isArray(p.investment)) {
      p.investment.forEach((inv, i) => {
        INVESTMENT_REQUIRED_FIELDS.forEach(f => {
          if (!(f in inv) || inv[f] === '' || inv[f] === null) {
            this._push(bag, 'error', {
              code: 'E105', layer: 2, category: 'schema_contract',
              field: `investment[${i}].${f}`, path_type: 'exact',
              message: `Field '${f}' wajib ada di investment entri ke-${i+1}.`,
              why_it_matters: 'Financial engine mengagregasi investasi per tahun dari field ini.',
              action: `Tambahkan '${f}' pada investment[${i}].`,
            });
          }
        });

        // E109 — amount_idr numeric
        if ('amount_idr' in inv && !this._isFiniteNumber(inv.amount_idr)) {
          this._push(bag, 'error', {
            code: 'E109', layer: 2, category: 'schema_contract',
            field: `investment[${i}].amount_idr`, path_type: 'exact',
            message: `amount_idr di investment[${i}] harus berupa angka.`,
            why_it_matters: 'Financial engine tidak bisa menghitung total investasi dengan nilai non-numerik.',
            action: `Ubah amount_idr menjadi angka, misalnya: 2826748198`,
            actual: typeof inv.amount_idr, expected: 'finite number',
          });
        }

        // E110 — investment year
        if ('year' in inv && !ctx.expected_years.includes(Number(inv.year))) {
          this._push(bag, 'error', {
            code: 'E110', layer: 2, category: 'schema_contract',
            field: `investment[${i}].year`, path_type: 'exact',
            message: `Tahun investasi ${inv.year} di luar rentang yang diharapkan.`,
            why_it_matters: 'Pipeline hanya memproses investasi dalam periode program.',
            action: `Gunakan salah satu: ${ctx.expected_years.join(', ')}.`,
            actual: inv.year, expected: ctx.expected_years.join(' | '),
          });
        }
      });

      // E112 — Duplicate investment (warning)
      const invKeys = {};
      p.investment.forEach((inv, i) => {
        const key = `${inv.year}|${inv.category || ''}|${inv.amount_idr || ''}`;
        if (invKeys[key] !== undefined) {
          this._push(bag, 'warning', {
            code: 'E112', layer: 2, category: 'schema_contract',
            field: `investment[${i}]`, path_type: 'exact',
            message: `Kemungkinan duplikat di investment[${i}] dan investment[${invKeys[key]}].`,
            why_it_matters: 'Duplikat bisa membuat total investasi lebih besar dari seharusnya.',
            action: `Periksa apakah investment[${i}] memang berbeda dari investment[${invKeys[key]}].`,
          });
        } else {
          invKeys[key] = i;
        }
      });
    }

    // E106 — Program code must match selected
    const detectedCode = p.program_identity?.program_code;
    if (detectedCode && ctx.program_code_selected &&
        detectedCode.toUpperCase() !== ctx.program_code_selected.toUpperCase()) {
      this._push(bag, 'error', {
        code: 'E106', layer: 2, category: 'schema_contract',
        field: 'program_identity.program_code', path_type: 'exact',
        message: `Program di JSON (${detectedCode}) tidak cocok dengan program yang dipilih (${ctx.program_code_selected}).`,
        why_it_matters: 'Mismatch program berisiko mengirim data ke target canonical yang salah.',
        action: `Samakan program_identity.program_code dengan pilihan di dropdown, atau ubah pilihan program.`,
        actual: detectedCode, expected: ctx.program_code_selected,
      });
    }

    // E107 — ori_rates must contain expected year keys
    if (this._isPlainObject(p.ori_rates)) {
      ctx.expected_years.forEach(yr => {
        if (!(String(yr) in p.ori_rates)) {
          this._push(bag, 'error', {
            code: 'E107', layer: 2, category: 'schema_contract',
            field: `ori_rates.${yr}`, path_type: 'exact',
            message: `ORI rate untuk tahun ${yr} tidak ditemukan.`,
            why_it_matters: 'Financial engine membutuhkan compound factor per tahun untuk kalkulasi SROI.',
            action: `Tambahkan key "${yr}" di ori_rates dengan series, rate, dan compound_factor.`,
          });
        }
      });
    }

    // E108 — coverage_status.bab_7
    const bab7 = p.coverage_status?.bab_7;
    if (bab7 !== undefined && bab7 !== 'strong') {
      const sev = ctx.options.failOnCoverageBab7 ? 'error' : 'warning';
      this._push(bag, sev, {
        code: 'E108', layer: 2, category: 'schema_contract',
        field: 'coverage_status.bab_7', path_type: 'exact',
        message: `coverage_status.bab_7 bernilai '${bab7}', harus 'strong'.`,
        why_it_matters: 'Point builder mensyaratkan bab_7 berstatus strong agar bisa menyusun outline.',
        action: `Ubah coverage_status.bab_7 menjadi "strong".`,
        actual: bab7, expected: 'strong',
      });
    }

    // E113 — source_refs must resolve to source_registry
    const registryIds = new Set(
      (p.source_registry || []).map(s => s.source_id).filter(Boolean)
    );
    if (Array.isArray(p.outcomes) && registryIds.size > 0) {
      p.outcomes.forEach((oc, i) => {
        (oc.source_refs || []).forEach(ref => {
          // Hanya check jika ref tampak seperti source ID (bukan nama field)
          if (ref.startsWith('SRC_') && !registryIds.has(ref)) {
            this._push(bag, 'warning', {
              code: 'E113', layer: 2, category: 'schema_contract',
              field: `outcomes[${i}].source_refs`, path_type: 'exact',
              message: `Referensi '${ref}' tidak ditemukan di source_registry.`,
              why_it_matters: 'Referensi yang tidak valid akan menghasilkan laporan tanpa sumber yang bisa ditelusuri.',
              action: `Tambahkan '${ref}' ke source_registry atau perbaiki referensinya.`,
            });
          }
        });
      });
    }

    // E115 — Required non-empty strings
    const nonEmptyChecks = [
      ['program_identity.program_code', p.program_identity?.program_code],
    ];
    if (Array.isArray(p.monetization)) {
      p.monetization.forEach((m, i) => {
        nonEmptyChecks.push([`monetization[${i}].aspect_code`, m.aspect_code]);
      });
    }
    if (this._isPlainObject(p.ddat_params)) {
      Object.entries(p.ddat_params).forEach(([asp, val]) => {
        if (val) nonEmptyChecks.push([`ddat_params.${asp}.justification`, val.justification]);
      });
    }
    nonEmptyChecks.forEach(([field, val]) => {
      if (val !== undefined && val !== null && val === '') {
        this._push(bag, 'error', {
          code: 'E115', layer: 2, category: 'schema_contract',
          field, path_type: 'exact',
          message: `Field '${field}' tidak boleh berupa string kosong.`,
          why_it_matters: 'String kosong pada field penting dapat menyebabkan narasi yang tidak lengkap.',
          action: `Isi field tersebut dengan nilai yang sesuai.`,
          actual: '""', expected: 'non-empty string',
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // LAYER 3 — DATA QUALITY
  // ═══════════════════════════════════════════════════════════

  static _validateDataQuality(ctx, bag) {
    const p = ctx.parsed;

    // W001 — Investment array empty
    if (Array.isArray(p.investment) && p.investment.length === 0) {
      this._push(bag, 'warning', {
        code: 'W001', layer: 3, category: 'data_quality',
        field: 'investment', path_type: 'group',
        message: 'Daftar investasi masih kosong.',
        why_it_matters: 'Laporan tidak bisa menampilkan kalkulasi investasi.',
        action: 'Tambahkan minimal satu entri investasi.',
      });
    }

    // W002 — All gross_idr are zero
    if (Array.isArray(p.monetization) && p.monetization.length > 0) {
      const allZero = p.monetization.every(m => Number(m.gross_idr) === 0);
      if (allZero) {
        this._push(bag, 'warning', {
          code: 'W002', layer: 3, category: 'data_quality',
          field: 'monetization', path_type: 'group',
          message: 'Semua nilai gross_idr masih 0.',
          why_it_matters: 'SROI akan bernilai 0 karena tidak ada nilai sosial yang dimonetisasi.',
          action: 'Periksa apakah gross_idr memang belum diisi atau memang nol.',
        });
      }
    }

    // W003 — Placeholder string anywhere in tree
    const placeholderPaths = [];
    this._walk(p, (val, path) => {
      if (typeof val === 'string' && val.toUpperCase().includes('PLACEHOLDER')) {
        placeholderPaths.push(path);
      }
    });
    if (placeholderPaths.length > 0) {
      placeholderPaths.slice(0, 5).forEach(path => {
        this._push(bag, 'warning', {
          code: 'W003', layer: 3, category: 'data_quality',
          field: path, path_type: 'exact',
          message: `Masih ada nilai PLACEHOLDER di ${path}.`,
          why_it_matters: 'Placeholder dapat terbawa ke laporan akhir.',
          action: `Ganti nilai PLACEHOLDER di ${path} dengan isi final atau hapus field tersebut.`,
        });
      });
      if (placeholderPaths.length > 5) {
        this._push(bag, 'warning', {
          code: 'W003', layer: 3, category: 'data_quality',
          field: 'multiple', path_type: 'synthetic',
          message: `Ada ${placeholderPaths.length} placeholder di dalam data (menampilkan 5 pertama).`,
          why_it_matters: 'Placeholder dapat terbawa ke laporan akhir.',
          action: 'Cari dan ganti semua nilai PLACEHOLDER dalam JSON.',
        });
      }
    }

    // W004 — net_multiplier outside sanity range
    if (this._isPlainObject(p.ddat_params)) {
      Object.entries(p.ddat_params).forEach(([asp, val]) => {
        if (val && this._isFiniteNumber(val.net_multiplier)) {
          const m = Number(val.net_multiplier);
          if (m < 0.1 || m > 0.9) {
            this._push(bag, 'warning', {
              code: 'W004', layer: 3, category: 'data_quality',
              field: `ddat_params.${asp}.net_multiplier`, path_type: 'exact',
              message: `net_multiplier ${m} untuk aspek ${asp} di luar rentang wajar (0.1–0.9).`,
              why_it_matters: 'Nilai di luar rentang ini tidak biasa secara metodologis SROI.',
              action: `Periksa kembali perhitungan DDAT untuk aspek ${asp}.`,
              actual: m, expected: '0.1–0.9',
            });
          }
        }
      });
    }

    // W005 — sroi_blended = 0 (info only)
    const sroi = p.sroi_metrics?.calculated?.sroi_blended ?? p.sroi_metrics?.sroi_blended;
    if (sroi !== undefined && Number(sroi) === 0) {
      this._push(bag, 'info', {
        code: 'W005', layer: 3, category: 'data_quality',
        field: 'sroi_metrics.sroi_blended', path_type: 'exact',
        message: 'Nilai sroi_blended masih 0.',
        why_it_matters: 'Ini normal — SROI final dihitung oleh financial engine, bukan diisi manual.',
        action: 'Tidak perlu tindakan. Pipeline akan mengisi nilai ini secara otomatis.',
      });
    }

    // W006 — Outcomes empty
    if (Array.isArray(p.outcomes) && p.outcomes.length === 0) {
      this._push(bag, 'warning', {
        code: 'W006', layer: 3, category: 'data_quality',
        field: 'outcomes', path_type: 'group',
        message: 'Daftar outcomes masih kosong.',
        why_it_matters: 'Narrative builder membutuhkan outcomes untuk menyusun narasi bab 7.',
        action: 'Tambahkan minimal satu outcome.',
      });
    }

    // W007 — All data_status pending
    const allStatuses = [];
    this._walk(p, (val, path) => {
      if (path.endsWith('.data_status') && typeof val === 'string') {
        allStatuses.push(val);
      }
    });
    if (allStatuses.length > 0 && allStatuses.every(s => s === 'pending')) {
      this._push(bag, 'warning', {
        code: 'W007', layer: 3, category: 'data_quality',
        field: 'data_status', path_type: 'synthetic',
        message: 'Semua data_status masih bernilai pending.',
        why_it_matters: 'Laporan akan menampilkan semua data sebagai belum final.',
        action: 'Perbarui data_status sesuai kondisi aktual data.',
      });
    }

    // W008 — All coverage_status weak
    if (this._isPlainObject(p.coverage_status)) {
      const vals = Object.values(p.coverage_status);
      if (vals.length > 0 && vals.every(v => v === 'weak')) {
        this._push(bag, 'warning', {
          code: 'W008', layer: 3, category: 'data_quality',
          field: 'coverage_status', path_type: 'group',
          message: 'Semua coverage_status bernilai weak.',
          why_it_matters: 'Narrative builder mungkin menghasilkan bab yang tipis di semua bagian.',
          action: 'Perbarui coverage_status berdasarkan kelengkapan data aktual.',
        });
      }
    }

    // W009 — Blank strings in narrative fields (sampling)
    const narrativeFields = [
      ['problem_framing.narrative', p.problem_framing?.narrative],
      ['ideal_conditions.vision_statement', p.ideal_conditions?.vision_statement],
      ['strategy_design.program_philosophy', p.strategy_design?.program_philosophy],
    ];
    narrativeFields.forEach(([field, val]) => {
      if (val !== undefined && val === '') {
        this._push(bag, 'warning', {
          code: 'W009', layer: 3, category: 'data_quality',
          field, path_type: 'exact',
          message: `Field narasi '${field}' masih kosong.`,
          why_it_matters: 'Field narasi kosong akan menghasilkan bab yang tidak informatif.',
          action: `Isi '${field}' dengan konten yang sesuai.`,
        });
      }
    });

    // W010 — Stakeholders missing or empty
    if (!p.stakeholders || (Array.isArray(p.stakeholders) && p.stakeholders.length === 0)) {
      this._push(bag, 'warning', {
        code: 'W010', layer: 3, category: 'data_quality',
        field: 'stakeholders', path_type: 'group',
        message: 'Daftar stakeholder kosong atau tidak ada.',
        why_it_matters: 'Narrative builder tidak bisa menyusun tabel stakeholder di bab 7.',
        action: 'Tambahkan minimal satu stakeholder.',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  static _push(bag, severity, issue) {
    const item = { severity, ...issue };
    if (severity === 'error')   bag.errors.push(item);
    else if (severity === 'warning') bag.warnings.push(item);
    else                             bag.infos.push(item);
  }

  static _isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  static _isFiniteNumber(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v === 'string') return v.trim() !== '' && isFinite(Number(v));
    return false;
  }

  static _isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  static _walk(obj, visitor, basePath = '') {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => this._walk(item, visitor, `${basePath}[${i}]`));
    } else if (this._isPlainObject(obj)) {
      Object.entries(obj).forEach(([k, v]) => {
        const path = basePath ? `${basePath}.${k}` : k;
        visitor(v, path);
        this._walk(v, visitor, path);
      });
    }
  }

  static _sortIssues(bag) {
    const sevOrder = { error: 0, warning: 1, info: 2 };
    const sort = (arr) => arr.sort((a, b) => {
      if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
      if (a.layer !== b.layer) return a.layer - b.layer;
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return (a.field || '').localeCompare(b.field || '');
    });
    sort(bag.errors);
    sort(bag.warnings);
    sort(bag.infos);
  }

  // ═══════════════════════════════════════════════════════════
  // FINALIZE
  // ═══════════════════════════════════════════════════════════

  static _finalize(ctx, bag) {
    const valid      = bag.errors.length === 0;
    const can_submit = valid;
    const status     = !valid ? 'error' : (bag.warnings.length > 0 ? 'warning' : 'pass');

    const summary   = this._buildSummary(ctx, bag);
    const field_map = this._buildFieldMap(ctx, bag);
    const stats     = this._buildStats(bag);

    return {
      valid, can_submit, status,
      errors:   bag.errors,
      warnings: bag.warnings,
      infos:    bag.infos,
      summary, field_map, stats,
      normalized: {
        program_code:   ctx.program_code_selected,
        expected_years: ctx.expected_years,
        issue_count: {
          error:   bag.errors.length,
          warning: bag.warnings.length,
          info:    bag.infos.length,
        },
      },
    };
  }

  static _buildSummary(ctx, bag) {
    const p = ctx.parsed;
    const errCodes = new Set(bag.errors.map(e => e.code));

    const detectCode = p?.program_identity?.program_code || null;
    let totalInv = null, totalGross = null;

    if (p && !errCodes.has('E001') && !errCodes.has('E002')) {
      if (Array.isArray(p.investment)) {
        totalInv = p.investment.reduce((s, i) => s + (Number(i.amount_idr) || 0), 0);
      }
      if (Array.isArray(p.monetization)) {
        totalGross = p.monetization.reduce((s, m) => s + (Number(m.gross_idr) || 0), 0);
      }
    }

    const invYears  = [...new Set((p?.investment   || []).map(i => Number(i.year)).filter(Boolean))].sort();
    const monYears  = [...new Set((p?.monetization || []).map(m => Number(m.year)).filter(Boolean))].sort();
    const oriYears  = p?.ori_rates ? Object.keys(p.ori_rates).map(Number).sort() : [];

    const reason = errCodes.has('E001') ? 'parse_failed'
                 : bag.errors.length > 0 ? 'has_errors'
                 : 'ready';

    return {
      structural:    { pass: !bag.errors.some(e => e.layer === 1), error_count: bag.errors.filter(e => e.layer === 1).length },
      schema_contract: { pass: !bag.errors.some(e => e.layer === 2), error_count: bag.errors.filter(e => e.layer === 2).length },
      data_quality:  { warning_count: bag.warnings.filter(e => e.layer === 3).length, info_count: bag.infos.filter(e => e.layer === 3).length },
      program: {
        selected_code: ctx.program_code_selected,
        detected_code: detectCode,
        program_name:  detectCode ? (PROGRAM_NAMES[detectCode.toUpperCase()] || null) : null,
      },
      counts: {
        source_registry: p?.source_registry?.length ?? 0,
        investment:      p?.investment?.length       ?? 0,
        outcomes:        p?.outcomes?.length         ?? 0,
        monetization:    p?.monetization?.length     ?? 0,
        stakeholders:    p?.stakeholders?.length     ?? null,
      },
      totals: { total_investment_idr: totalInv, total_gross_idr: totalGross },
      years:  { expected: ctx.expected_years, investment: invYears, monetization: monYears, ori_rates: oriYears },
      submit_status: { can_submit: bag.errors.length === 0, reason },
    };
  }

  static _buildFieldMap(ctx, bag) {
    const allIssues = [...bag.errors, ...bag.warnings, ...bag.infos];
    const sevRank   = { error: 3, warning: 2, info: 1, ok: 0 };

    const groupFor = (field = '') => {
      const top = field.split('.')[0].replace(/\[.*$/, '');
      return top || 'root';
    };

    const map = {};
    allIssues.forEach(issue => {
      const group = groupFor(issue.field);
      if (!map[group]) map[group] = { status: 'ok', codes: [] };
      if (!map[group].codes.includes(issue.code)) map[group].codes.push(issue.code);
      if (sevRank[issue.severity] > sevRank[map[group].status]) {
        map[group].status = issue.severity;
      }
    });

    // Tambahkan field yang tidak punya issue sebagai ok
    const knownGroups = ['root','program_identity','source_registry','investment',
      'outcomes','monetization','ddat_params','ori_rates','sroi_metrics','coverage_status',
      'strategy_design','stakeholders','activities','outputs','learning_signals'];
    knownGroups.forEach(g => { if (!map[g]) map[g] = { status: 'ok', codes: [] }; });

    return map;
  }

  static _buildStats(bag) {
    const byLayer = { 1:{errors:0,warnings:0,infos:0}, 2:{errors:0,warnings:0,infos:0}, 3:{errors:0,warnings:0,infos:0} };
    bag.errors.forEach(e   => { if (byLayer[e.layer]) byLayer[e.layer].errors++; });
    bag.warnings.forEach(w => { if (byLayer[w.layer]) byLayer[w.layer].warnings++; });
    bag.infos.forEach(i    => { if (byLayer[i.layer]) byLayer[i.layer].infos++; });
    return {
      total_errors:   bag.errors.length,
      total_warnings: bag.warnings.length,
      total_infos:    bag.infos.length,
      by_layer:       byLayer,
    };
  }
}

// Export untuk browser (global) dan Node.js (untuk testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CanonicalValidator;
}
