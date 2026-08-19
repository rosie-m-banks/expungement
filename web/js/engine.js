/* engine.js
 * Ports: web_server.py (decode_answers), gather_info.py,
 *        case_classes/, expungers/
 *
 * All state is persisted in sessionStorage under 'engine_state' so it
 * survives page navigations within the same tab.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Date helpers                                                        */
  /* ------------------------------------------------------------------ */

  function msFromDays(days) { return days * 24 * 60 * 60 * 1000; }

  function addDays(date, days) {
    return new Date(date.getTime() + msFromDays(days));
  }

  function fmtDate(date) {
    if (!date || !(date instanceof Date)) return '(unknown)';
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${m}-${d}-${date.getFullYear()}`;
  }

  /* ------------------------------------------------------------------ */
  /*  Answer decoding  (mirrors web_server.py decode_answers)            */
  /* ------------------------------------------------------------------ */

  function decodeOne(q, raw) {
    const rtype = q.response_type;
    if (rtype === 'Boolean') {
      if (typeof raw === 'boolean') return raw;
      return /^(yes|y|true|1)$/i.test(String(raw).trim());
    }
    if (rtype === 'Int') return parseInt(raw, 10);
    if (rtype === 'Float') return parseFloat(raw);
    if (rtype === 'Date') {
      const [mo, day, yr] = String(raw).split('-');
      return new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, parseInt(day, 10));
    }
    if (rtype === 'DateList') {
      if (typeof raw === 'string') {
        raw = raw.trim();
        if (!raw || raw === '[]') return [];
        return raw.split(',').map(s => {
          const [mo, day, yr] = s.trim().split('-');
          return new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, parseInt(day, 10));
        });
      }
      if (Array.isArray(raw)) {
        return raw.map(s => {
          const [mo, day, yr] = String(s).split('-');
          return new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, parseInt(day, 10));
        });
      }
      return [];
    }
    if (rtype === 'DateStringPairList') {
      if (Array.isArray(raw)) {
        return raw.map(item => {
          if (Array.isArray(item) && item.length === 2) {
            const [mo, day, yr] = String(item[0]).split('-');
            return [new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, parseInt(day, 10)), String(item[1])];
          }
          return null;
        }).filter(Boolean);
      }
      return [];
    }
    if (rtype === 'StringList') {
      if (typeof raw === 'string') {
        raw = raw.trim();
        if (!raw || raw === '[]') return [];
        return raw.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
      return [];
    }
    if (rtype === 'ClassifiedStringList') {
      if (Array.isArray(raw)) {
        return raw.map(item => {
          if (Array.isArray(item) && item.length === 2) return [String(item[0]), String(item[1])];
          return [String(item), 'none'];
        });
      }
      return [];
    }
    return String(raw);
  }

  function decodeAnswers(questions, rawAnswers) {
    return questions.map((q, i) => decodeOne(q, rawAnswers[i]));
  }

  /* ------------------------------------------------------------------ */
  /*  Question loading                                                   */
  /* ------------------------------------------------------------------ */

  async function loadQuestions(filenames) {
    if (typeof filenames === 'string') filenames = [filenames];
    const questions = [];
    for (const fn of filenames) {
      const basename = fn.replace(/^.*\//, '');
      const resp = await fetch('questions/' + basename);
      const data = await resp.json();
      const offset = questions.length;
      const keys = Object.keys(data).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
      const keyToIdx = {};
      keys.forEach((k, i) => { keyToIdx[k] = offset + i; });
      for (const key of keys) {
        const q = Object.assign({}, data[key]);
        if (q.dependancy) {
          const parts = q.dependancy.split(',').map(s => s.trim());
          q.dependancy = `${keyToIdx[parts[0]]},${parts[1]}`;
        }
        questions.push(q);
      }
    }
    return questions;
  }

  /* ------------------------------------------------------------------ */
  /*  Case classes                                                       */
  /* ------------------------------------------------------------------ */

  class Arrest {
    constructor({ case_name, arresting_agency, arrest_date, expir_no_risk, resolved }) {
      this.case_name = case_name;
      this.arresting_agency = arresting_agency;
      this.arrest_date = arrest_date;
      this.expir_no_risk = expir_no_risk;
      this.resolved = resolved;
    }
  }

  class Felony {
    constructor({ case_name, arresting_agency, arrest_date, addl_arrests, court, resolved,
      convic_dismiss_defer_drug, counts, sentencing_date, fines_paid, expir_no_risk, treatment }) {
      this.case_name = case_name;
      this.arresting_agency = arresting_agency;
      this.arrest_date = arrest_date;
      this.addl_arrests = addl_arrests || [];
      this.court = court;
      this.resolved = resolved;
      this.convic_dismiss_defer_drug = convic_dismiss_defer_drug;
      this.counts = counts || [];
      this.sentencing_date = sentencing_date;
      this.fines_paid = fines_paid;
      this.expir_no_risk = expir_no_risk;
      this.treatment = treatment;
    }
    isConvicted()    { return this.convic_dismiss_defer_drug === 1; }
    isDismissed()    { return this.convic_dismiss_defer_drug === 2; }
    isDeferred()     { return this.convic_dismiss_defer_drug === 3; }
    isDrugDismissed(){ return this.convic_dismiss_defer_drug === 4; }
  }

  class Misdemeanor {
    constructor({ case_name, arresting_agency, arrest_date, addl_arrests, court, resolved,
      convic_dismiss_defer_drug, treatment, sentencing_date, fines_paid, expir_no_risk, fine_amount, imprisoned }) {
      this.case_name = case_name;
      this.arresting_agency = arresting_agency;
      this.arrest_date = arrest_date;
      this.addl_arrests = addl_arrests || [];
      this.court = court;
      this.resolved = resolved;
      this.convic_dismiss_defer_drug = convic_dismiss_defer_drug;
      this.treatment = treatment;
      this.sentencing_date = sentencing_date;
      this.fines_paid = fines_paid;
      this.expir_no_risk = expir_no_risk;
      this.fine_amount = fine_amount;
      this.imprisoned = imprisoned;
    }
    isConvicted()    { return this.convic_dismiss_defer_drug === 1; }
    isDismissed()    { return this.convic_dismiss_defer_drug === 2; }
    isDeferred()     { return this.convic_dismiss_defer_drug === 3; }
    isDrugDismissed(){ return this.convic_dismiss_defer_drug === 4; }
  }

  /* ------------------------------------------------------------------ */
  /*  Details builder  (mirrors screening.py build_details)             */
  /* ------------------------------------------------------------------ */

  function buildDetails(c) {
    const lines = [];
    if (c.arresting_agency) lines.push(`Arresting agency: ${c.arresting_agency}`);
    if (c.court) lines.push(`Court: ${c.court}`);
    if (c.arrest_date instanceof Date) lines.push(`Arrest date: ${fmtDate(c.arrest_date)}`);
    if (c.addl_arrests && c.addl_arrests.length > 0) {
      const entries = c.addl_arrests.map(item => {
        if (Array.isArray(item)) {
          const [dt, agency] = item;
          return `${dt instanceof Date ? fmtDate(dt) : dt} (${agency})`;
        }
        return item instanceof Date ? fmtDate(item) : String(item);
      });
      lines.push(`Additional arrests: ${entries.join(', ')}`);
    }
    if (c.sentencing_date instanceof Date) lines.push(`Sentencing date: ${fmtDate(c.sentencing_date)}`);
    if (c.counts && c.counts.length > 0) {
      lines.push(`Charges: ${c.counts.map(([name, cls]) => `${name} [${cls}]`).join(', ')}`);
    }
    if (c.fine_amount !== undefined && c.fine_amount !== null) {
      lines.push(`Fine amount: $${c.fine_amount}`);
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  ArrestExpunger  (ports expungers/arrest_expunger.py)              */
  /* ------------------------------------------------------------------ */

  class ArrestExpunger {
    constructor(arrests, caseResults) {
      this.arrests = arrests;
      this.caseResults = caseResults;
    }
    expunge() {
      for (const a of this.arrests) {
        if (a.expir_no_risk) {
          this.caseResults[a.case_name] = 'Expungeable because of arrest no charges filed. ';
        } else {
          this.caseResults[a.case_name] = 'Not expungeable because SOL not expired and prosecutor did not confirm in writing that no charges will be filed. ';
        }
      }
      return this.caseResults;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  MisdoExpunger  (ports expungers/misdo_expunger.py)                */
  /* ------------------------------------------------------------------ */

  class MisdoExpunger {
    constructor(misdemeanors, caseResults, canWaiveMisdos) {
      this.misdemeanors = misdemeanors;
      this.caseResults = caseResults;
      this.canWaiveMisdos = canWaiveMisdos;
      this.today = new Date();
    }

    findResolvedCases() {
      for (const m of this.misdemeanors) {
        if (m.case_name in this.caseResults) continue;
        if (m.resolved) {
          this.caseResults[m.case_name] = 'Immediately expungeable because case resolved by any of \nAcquittal\nReversed on appeal, dismissed by DA\nDismissed on appeal\nDNA dismissal \nFull pardon by governor\nUnder 18, full pardon\nIdentity theft';
        }
      }
    }

    findDrugDismissed() {
      for (const m of this.misdemeanors) {
        if (m.case_name in this.caseResults) continue;
        if (!m.isDrugDismissed()) continue;
        if (!m.treatment) {
          this.caseResults[m.case_name] = 'Not expungeable since drug program not completed.';
        } else if (!m.fines_paid) {
          this.caseResults[m.case_name] = 'Not expungeable since fines, fees, or restitution not paid. This individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. ';
        } else {
          this.caseResults[m.case_name] = 'Expungeable due to dismissal after drug court, drug program completed, and fines, fees, and restitution fully paid.';
        }
      }
    }

    expungeConviction(m) {
      if (m.fine_amount < 501 && !m.imprisoned) {
        if (!m.fines_paid) {
          this.caseResults[m.case_name] = 'Not expungeable since fines, fees, or restitution not paid. This individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. ';
          return false;
        }
        this.caseResults[m.case_name] = 'Expungeable. Fine < $501 and fines, fees, and restitution fully paid.';
        return true;
      }
      if (!m.fines_paid) {
        this.caseResults[m.case_name] = `Not expungeable since fines, fees, or restitution not paid. After, ${fmtDate(addDays(m.sentencing_date, 365 * 5))}, this individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. `;
        return false;
      }
      if (this.today - m.sentencing_date < msFromDays(365 * 5)) {
        this.caseResults[m.case_name] = `Not expungeable since < 5 years since end of sentence. May be eligible after ${fmtDate(addDays(m.sentencing_date, 365 * 5))}.`;
        return false;
      }
      this.caseResults[m.case_name] = 'Expungeable. >= 5 years since sentencing, and fines, fees, and restitution fully paid.';
      return true;
    }

    expungeDismissal(m) {
      if (m.isDeferred()) {
        if (!m.fines_paid) {
          this.caseResults[m.case_name] = `Not expungeable since fines, fees, or restitution not paid. After, ${fmtDate(addDays(m.sentencing_date, 365))}, this individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. `;
          return false;
        }
        if (this.today - m.sentencing_date < msFromDays(365)) {
          this.caseResults[m.case_name] = `Not expungeable. < 1 year since dismissal. May be eligible after ${fmtDate(addDays(m.sentencing_date, 365))}.`;
          return false;
        }
        this.caseResults[m.case_name] = 'Expungeable. > 1 year since dismissal and fines, fees, and restitution fully paid.';
        return true;
      }
      if (!m.expir_no_risk) {
        this.caseResults[m.case_name] = "Not expungeable. The SOL hasn't expired, DA hasn't confirmed they won't refile, and case hasn't been dismissed with paid or waived costs.";
        return false;
      }
      this.caseResults[m.case_name] = "Expungeable. The SOL has expired, or DA has confirmed they won't refile, or case has been dismissed with paid or waived costs.";
      return true;
    }

    expunge() {
      this.findResolvedCases();
      if (!this.canWaiveMisdos) {
        for (const m of this.misdemeanors) {
          if (!(m.case_name in this.caseResults)) {
            this.caseResults[m.case_name] = 'Not expungeable because of non-expungeable felony convictions.';
          }
        }
        return this.caseResults;
      }
      this.findDrugDismissed();
      for (const m of this.misdemeanors) {
        if (m.case_name in this.caseResults) continue;
        if (m.isDismissed() || m.isDeferred()) {
          this.expungeDismissal(m);
        } else {
          this.expungeConviction(m);
        }
      }
      return this.caseResults;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  FelonyExpunger  (ports expungers/felony_expunger.py)              */
  /* ------------------------------------------------------------------ */

  class FelonyExpunger {
    constructor(felonies, misdemeanors, caseResults) {
      this.felonies = felonies;
      this.misdemeanorConvictions = misdemeanors.filter(m => m.isConvicted());
      this.caseResults = caseResults;
      this.numFelonyConvictions = felonies.filter(f => f.isConvicted()).length;
      this.today = new Date();
    }

    findResolvedCases() {
      for (const f of this.felonies) {
        if (f.case_name in this.caseResults) continue;
        if (f.resolved) {
          this.caseResults[f.case_name] = 'Immediately expungeable because case resolved by any of \nAcquittal\nReversed on appeal, dismissed by DA\nDismissed on appeal\nDNA dismissal \nFull pardon by governor\nUnder 18, full pardon\nIdentity theft';
          if (f.isConvicted()) this.numFelonyConvictions--;
        }
      }
    }

    findReclassifiedFelonies() {
      const toProcess = [];
      for (const f of this.felonies) {
        if (f.case_name in this.caseResults) continue;
        if (f.counts && f.counts.length > 0 && f.counts.every(([, cls]) => cls === 'reclassified')) {
          toProcess.push(f);
          if (f.isConvicted()) this.numFelonyConvictions--;
        }
      }
      for (const f of toProcess) {
        const dat = this.today - f.sentencing_date > msFromDays(30);
        const fine = f.fines_paid;
        const treatment = f.treatment;
        if (dat && fine && treatment) {
          this.caseResults[f.case_name] = 'Expungeable due to reclassification as misdemeanor, > 30 days since sentencing, fines, fees, or restitution paid, and if relevant, treatment program completed.';
        } else {
          this.caseResults[f.case_name] = 'Not expungeable. Reclassified as misdemeanor. ';
          if (fine && treatment) {
            this.caseResults[f.case_name] += `Time since sentencing < 30 days. This may be eligible for expungement after ${fmtDate(addDays(f.sentencing_date, 30))}. `;
          } else if (treatment) {
            this.caseResults[f.case_name] += `After ${fmtDate(addDays(f.sentencing_date, 30))}, this individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. `;
          } else {
            this.caseResults[f.case_name] += 'Treatment program not finished.';
          }
        }
      }
    }

    findDrugDismissed() {
      for (const f of this.felonies) {
        if (f.case_name in this.caseResults) continue;
        if (!f.isDrugDismissed()) continue;
        this.caseResults[f.case_name] = 'Not expungeable. ';
        if (!f.treatment || !f.fines_paid) {
          if (!f.fines_paid) this.caseResults[f.case_name] += 'Fines, fees, or restitution not paid.';
          if (!f.treatment) {
            this.caseResults[f.case_name] += 'Drug program not completed. ';
          } else {
            this.caseResults[f.case_name] += 'This individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>.';
          }
        } else {
          this.caseResults[f.case_name] = 'Expungeable due to dismissal after drug court, program completed, and fines, fees, or restitution paid.';
        }
      }
    }

    isViolent(f) {
      return f.counts && f.counts.some(([, cls]) => cls === '571' || cls === '13-sora');
    }

    expungeFelonyNonviolent(f) {
      const nonviolent = !this.isViolent(f);
      const fine = f.fines_paid;
      const dat = this.today - f.sentencing_date > msFromDays(5 * 365);
      if (fine && nonviolent && dat) {
        this.caseResults[f.case_name] = 'Expungeable due to nonviolent felony criteria (no other felony convictions, no misdemeanor convictions in the last 7 years, 5 years since sentence completion, all fines paid).';
        return [true, 0];
      }
      this.caseResults[f.case_name] = 'Not expungeable. ';
      if (fine && nonviolent) {
        this.caseResults[f.case_name] += `5 year waiting period not yet reached. Client may be eligible after ${fmtDate(addDays(f.sentencing_date, 365 * 5))} `;
      } else if (nonviolent) {
        this.caseResults[f.case_name] += `After ${fmtDate(addDays(f.sentencing_date, 365 * 5))}, this individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. `;
      } else if (fine) {
        this.caseResults[f.case_name] += `This individual may be eligible for expungement after receiving a pardon from the Governor after this date: ${fmtDate(addDays(f.sentencing_date, 365 * 5))}.  More information about filing for a pardon can be found <here, https://oklahoma.gov/ppb.html>.`;
        return [false, 1];
      } else {
        this.caseResults[f.case_name] += `Violent felony under Section 571. After ${fmtDate(addDays(f.sentencing_date, 365 * 5))}, this individual may be eligible to receive a pardon after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. If a pardon is received, this individual may be eligible for expungement. More information about filing for a pardon can be found <here, https://oklahoma.gov/ppb.html>. `;
      }
      return [false, 0];
    }

    expungeConvictionNonviolent(f) {
      if (this.numFelonyConvictions > 1) {
        this.caseResults[f.case_name] = 'Not expungeable. More than one felony conviction.';
        return [false, 1];
      }
      const allOld = this.misdemeanorConvictions.every(
        m => this.today - m.sentencing_date > msFromDays(365 * 7)
      );
      if (allOld) return this.expungeFelonyNonviolent(f);
      const maxDate = this.misdemeanorConvictions.reduce(
        (mx, m) => m.sentencing_date > mx ? m.sentencing_date : mx,
        new Date(0)
      );
      this.caseResults[f.case_name] = `Not expungeable. Misdemeanor convictions within the last 7 years. Screen again after ${fmtDate(addDays(maxDate, 365 * 7))}.`;
      return [false, 1];
    }

    expungeMaybeViolent(f) {
      const notHorrible = !(f.counts && f.counts.some(([, cls]) => cls === '13-sora'));
      const fine = f.fines_paid;
      const dat = this.today - f.sentencing_date > msFromDays(3650);
      if (fine && dat && notHorrible) {
        this.caseResults[f.case_name] = 'Expungeable due to criteria: no counts listed in Section 13, 10 years since sentence completion, all fines paid).';
        return true;
      } else if (!fine && notHorrible) {
        this.caseResults[f.case_name] = `Not expungeable. After ${fmtDate(addDays(f.sentencing_date, 3650))}, this individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>. `;
      } else if (fine) {
        this.caseResults[f.case_name] = `Not expungeable. This individual may be eligible for expungement after receiving a pardon from the Governor after this date: ${fmtDate(addDays(f.sentencing_date, 365 * 5))}.  More information about filing for a pardon can be found <here, https://oklahoma.gov/ppb.html>. `;
        if (notHorrible && !dat) {
          this.caseResults[f.case_name] += ` Alternatively, this case may be expungeable after this date: ${fmtDate(addDays(f.sentencing_date, 3650))} `;
        }
      } else {
        this.caseResults[f.case_name] = 'Not expungeable. Violent felony under Section 13.1 of Title 21 or SORA. ';
      }
      return false;
    }

    expungeConvictions(f) {
      const [result, num] = this.expungeConvictionNonviolent(f);
      if (!result && num === 1) return this.expungeMaybeViolent(f);
      return result;
    }

    expungeDismissals(f) {
      if (f.isDeferred()) {
        const [result, num] = this.expungeFelonyNonviolent(f);
        if (!result && num === 1) return this.expungeMaybeViolent(f);
        return result;
      }
      if (!f.expir_no_risk) {
        this.caseResults[f.case_name] = "Not expungeable. The SOL hasn't expired, DA hasn't confirmed they won't refile, and case hasn't been dismissed with paid or waived costs.";
        return false;
      }
      this.caseResults[f.case_name] = "Expungeable. The SOL has expired, or DA has confirmed they won't refile, or case has been dismissed with paid or waived costs.";
      return true;
    }

    expunge() {
      this.findResolvedCases();
      this.findReclassifiedFelonies();
      this.findDrugDismissed();

      if (this.numFelonyConvictions > 2) {
        for (const f of this.felonies) {
          if (!(f.case_name in this.caseResults)) {
            this.caseResults[f.case_name] = `Not expungeable because client has ${this.numFelonyConvictions} felony convictions. Recommend they seek a pardon. More information about filing for a pardon can be found <here, https://oklahoma.gov/ppb.html>.`;
          }
        }
        return [false, this.caseResults];
      }

      let allConvictionsCleared = true;
      for (const f of this.felonies) {
        if (f.case_name in this.caseResults) continue;
        if (f.isConvicted()) {
          if (!this.expungeConvictions(f)) allConvictionsCleared = false;
        }
      }

      if (!allConvictionsCleared) {
        for (const f of this.felonies) {
          if (!(f.case_name in this.caseResults)) {
            this.caseResults[f.case_name] = 'Not expungeable because client unable to expunge all felony convictions.';
          }
        }
        return [false, this.caseResults];
      }

      for (const f of this.felonies) {
        if (!(f.case_name in this.caseResults)) {
          this.expungeDismissals(f);
        }
      }

      return [true, this.caseResults];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  State serialization / deserialization                              */
  /* ------------------------------------------------------------------ */

  const STATE_KEY = 'engine_state';

  /* Invariant: state.cases.* always holds live Arrest/Felony/Misdemeanor
   * instances with real Date fields. saveState is the only place that
   * serializes and loadState is the only place that revives, so neither
   * conversion may be applied twice — dateToMs turns an already-serialized
   * millisecond value into null, which silently erases the date. */

  function dateToMs(d) { return d instanceof Date ? d.getTime() : null; }
  function msToDate(ms) { return ms !== null && ms !== undefined ? new Date(ms) : null; }

  function serializeArrest(a) {
    return {
      case_name: a.case_name, arresting_agency: a.arresting_agency,
      arrest_date: dateToMs(a.arrest_date), expir_no_risk: a.expir_no_risk,
      resolved: a.resolved,
    };
  }
  function reviveArrest(o) {
    return new Arrest({ ...o, arrest_date: msToDate(o.arrest_date) });
  }

  function serializeFelony(f) {
    return {
      case_name: f.case_name, arresting_agency: f.arresting_agency,
      arrest_date: dateToMs(f.arrest_date),
      addl_arrests: (f.addl_arrests || []).map(item =>
        Array.isArray(item) ? [dateToMs(item[0]), item[1]] : item
      ),
      court: f.court, resolved: f.resolved,
      convic_dismiss_defer_drug: f.convic_dismiss_defer_drug,
      counts: f.counts, sentencing_date: dateToMs(f.sentencing_date),
      fines_paid: f.fines_paid, expir_no_risk: f.expir_no_risk,
      treatment: f.treatment,
    };
  }
  function reviveFelony(o) {
    return new Felony({
      ...o,
      arrest_date: msToDate(o.arrest_date),
      sentencing_date: msToDate(o.sentencing_date),
      addl_arrests: (o.addl_arrests || []).map(item =>
        Array.isArray(item) ? [msToDate(item[0]), item[1]] : item
      ),
    });
  }

  function serializeMisdo(m) {
    return {
      case_name: m.case_name, arresting_agency: m.arresting_agency,
      arrest_date: dateToMs(m.arrest_date),
      addl_arrests: (m.addl_arrests || []).map(item =>
        Array.isArray(item) ? [dateToMs(item[0]), item[1]] : item
      ),
      court: m.court, resolved: m.resolved,
      convic_dismiss_defer_drug: m.convic_dismiss_defer_drug,
      treatment: m.treatment, sentencing_date: dateToMs(m.sentencing_date),
      fines_paid: m.fines_paid, expir_no_risk: m.expir_no_risk,
      fine_amount: m.fine_amount, imprisoned: m.imprisoned,
    };
  }
  function reviveMisdo(o) {
    return new Misdemeanor({
      ...o,
      arrest_date: msToDate(o.arrest_date),
      sentencing_date: msToDate(o.sentencing_date),
      addl_arrests: (o.addl_arrests || []).map(item =>
        Array.isArray(item) ? [msToDate(item[0]), item[1]] : item
      ),
    });
  }

  function saveState(state) {
    const serializable = {
      phase: state.phase,
      numCases: state.numCases,
      currentCaseIndex: state.currentCaseIndex,
      currentCaseType: state.currentCaseType,
      earlyExitMessages: state.earlyExitMessages,
      cases: {
        felonies: (state.cases.felonies || []).map(serializeFelony),
        misdos: (state.cases.misdos || []).map(serializeMisdo),
        arrests: (state.cases.arrests || []).map(serializeArrest),
      },
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(serializable));
  }

  function loadState() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    s.cases.felonies = (s.cases.felonies || []).map(reviveFelony);
    s.cases.misdos   = (s.cases.misdos   || []).map(reviveMisdo);
    s.cases.arrests  = (s.cases.arrests  || []).map(reviveArrest);
    return s;
  }

  function newState() {
    return {
      phase: 'init',
      numCases: 0,
      currentCaseIndex: 0,
      currentCaseType: null,
      earlyExitMessages: [],
      cases: { felonies: [], misdos: [], arrests: [] },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Early-exit messages (mirrors gather_info.py prelim_questions)     */
  /* ------------------------------------------------------------------ */

  const EARLY_EXIT_MSGS = {
    pending: 'While some records may be eligible for expungement, such as pardoned cases, many records will not be eligible due to the pending charges or unexpired deferred sentence.  Generally, it is recommended that the person wait until the pending charges are resolved or the deferred sentence has expired.',
    out_of_state: "While there is a process for pardon of federal crimes, there is no process for expungement. This tool is also not appropriate to analyze expungement eligibility for cases in other states. While some Oklahoma records may be expungeable, such as pardoned cases, out-of-state or federal records can complicate the expungement analysis, so this person's record are not suitable to be analyzed by this tool.",
    serving: 'While some records may be eligible for expungement, such as pardoned cases, many records will not be eligible due to the current sentence being served.  Generally, it is recommended that the person wait until completing their sentence for all cases before applying for expungement.',
  };

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  async function start() {
    const state = newState();
    state.phase = 'prelim';
    saveState(state);
    const questions = await loadQuestions('prelim_questions.json');
    return { questions, filenames: ['prelim_questions.json'] };
  }

  async function submitAnswers(rawAnswers) {
    const questionsJson = sessionStorage.getItem('current_questions');
    if (!questionsJson) throw new Error('No pending questions in session');
    const questions = JSON.parse(questionsJson);
    const answers = decodeAnswers(questions, rawAnswers);

    const state = loadState();
    if (!state) throw new Error('No engine state found');

    if (state.phase === 'prelim')       return _handlePrelim(state, answers);
    if (state.phase === 'case-type')    return _handleCaseType(state, answers);
    if (state.phase === 'case-details') return _handleCaseDetails(state, answers);
    throw new Error('Unexpected phase: ' + state.phase);
  }

  async function _handlePrelim(state, answers) {
    const [pending, out_of_state, serving, num_cases] = answers;
    const messages = [];
    if (pending)     messages.push(EARLY_EXIT_MSGS.pending);
    if (out_of_state) messages.push(EARLY_EXIT_MSGS.out_of_state);
    if (serving)     messages.push(EARLY_EXIT_MSGS.serving);

    if (messages.length > 0) {
      state.earlyExitMessages = messages;
      state.phase = 'done';
      saveState(state);
      return { status: 'early_exit', messages };
    }

    state.numCases = num_cases;
    state.phase = 'case-type';
    saveState(state);
    const questions = await loadQuestions('case_questions.json');
    return { questions, filenames: ['case_questions.json'] };
  }

  async function _handleCaseType(state, answers) {
    const caseType = answers[0];
    state.currentCaseType = caseType;

    let filenames;
    if (caseType === 0) {
      filenames = ['shared_questions.json', 'felony_questions.json'];
    } else if (caseType === 1) {
      filenames = ['shared_questions.json', 'misdo_questions.json'];
    } else {
      filenames = ['arrest_questions.json'];
    }

    state.phase = 'case-details';
    saveState(state);
    const questions = await loadQuestions(filenames);
    return { questions, filenames };
  }

  async function _handleCaseDetails(state, answers) {
    const caseType = state.currentCaseType;

    if (caseType === 0) {
      const [case_name, arresting_agency, arrest_date, addl_arrests, court, resolved,
        convic_dismiss_defer_drug, treatment, sentencing_date, fines_paid, expir_no_risk, counts] = answers;
      state.cases.felonies.push(new Felony({
        case_name, arresting_agency, arrest_date, addl_arrests, court, resolved,
        convic_dismiss_defer_drug, counts, sentencing_date, fines_paid, expir_no_risk, treatment,
      }));
    } else if (caseType === 1) {
      const [case_name, arresting_agency, arrest_date, addl_arrests, court, resolved,
        convic_dismiss_defer_drug, treatment, sentencing_date, fines_paid, expir_no_risk,
        fine_amount, imprisoned] = answers;
      state.cases.misdos.push(new Misdemeanor({
        case_name, arresting_agency, arrest_date, addl_arrests, court, resolved,
        convic_dismiss_defer_drug, treatment, sentencing_date, fines_paid, expir_no_risk,
        fine_amount, imprisoned,
      }));
    } else {
      const [case_name, arresting_agency, arrest_date, expir_no_risk] = answers;
      state.cases.arrests.push(new Arrest({
        case_name, arresting_agency, arrest_date, expir_no_risk, resolved: true,
      }));
    }

    state.currentCaseIndex++;

    if (state.currentCaseIndex >= state.numCases) {
      state.phase = 'done';
      saveState(state);
      return { status: 'data_collected' };
    }

    state.phase = 'case-type';
    saveState(state);
    const questions = await loadQuestions('case_questions.json');
    return { questions, filenames: ['case_questions.json'] };
  }

  async function classifyCounts(counts) {
    if (!window.geminiClassify) throw new Error('Gemini classifier not loaded');
    return window.geminiClassify.classifyCounts(counts);
  }

  async function analyze() {
    const state = loadState();
    if (!state) return [];

    const felonies = state.cases.felonies || [];
    const misdos   = state.cases.misdos   || [];
    const arrests  = state.cases.arrests  || [];
    const earlyExitMessages = state.earlyExitMessages || [];

    if (felonies.length === 0 && misdos.length === 0 && arrests.length === 0) {
      return earlyExitMessages.map(m => ({ type: 'message', data: m }));
    }

    const caseResults = {};

    new ArrestExpunger(arrests, caseResults).expunge();
    const [canWaiveMisdos] = new FelonyExpunger(felonies, misdos, caseResults).expunge();
    new MisdoExpunger(misdos, caseResults, canWaiveMisdos).expunge();

    const overallResults = {};
    for (const c of [...arrests, ...felonies, ...misdos]) {
      overallResults[c.case_name] = {
        verdict: caseResults[c.case_name] || 'No result',
        details: buildDetails(c),
      };
    }

    const out = earlyExitMessages.map(m => ({ type: 'message', data: m }));
    out.push({ type: 'cases', data: overallResults });
    out.push({ type: 'message', data: 'Cosine similarity used for Section 571, Section 13, and SORA classification. Use with discretion.' });
    return out;
  }

  function hasState() {
    return sessionStorage.getItem(STATE_KEY) !== null;
  }

  window.engine = { start, submitAnswers, classifyCounts, analyze, hasState };
})();
