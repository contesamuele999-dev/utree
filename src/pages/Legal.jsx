// Pagine legali: Privacy e Termini. Testo base, da far rivedere a un legale
// prima della pubblicazione pubblica.
export function Privacy() {
  return (
    <div className="legal">
      <h1>Informativa sulla Privacy</h1>
      <p><em>Ultimo aggiornamento: giugno 2026</em></p>

      <p>uTree ("l'App") rispetta la tua privacy. Questa informativa spiega quali dati raccogliamo,
      come li usiamo e quali sono i tuoi diritti, in conformità al Regolamento (UE) 2016/679 (GDPR).</p>

      <h2>1. Titolare del trattamento</h2>
      <p>Il titolare del trattamento è Samuele Contessa, sviluppatore di uTree.
      Per qualsiasi richiesta relativa ai tuoi dati puoi contattare il titolare tramite i recapiti indicati nell'App.</p>

      <h2>2. Dati raccolti</h2>
      <p>Raccogliamo l'indirizzo email e una password cifrata necessari per la creazione e l'accesso all'account,
      e i contenuti che crei nell'App (vite, visioni, viste e collegamenti). Non vendiamo i tuoi dati a terzi.</p>

      <h2>3. Finalità e base giuridica</h2>
      <p>I dati sono trattati per fornirti il servizio (esecuzione del contratto), per garantire la sicurezza
      dell'account e per il funzionamento tecnico della sincronizzazione. I contenuti sono accessibili solo a te.</p>

      <h2>4. Conservazione, hosting e fornitori (sub-responsabili)</h2>
      <p>Per erogare il servizio ci avvaliamo dei seguenti fornitori che trattano i dati per nostro conto, in qualità di
      responsabili del trattamento:</p>
      <p><b>Supabase</b> (Supabase, Inc.) — fornisce l'autenticazione, il database e la sincronizzazione cloud. Su Supabase
      sono conservati il tuo indirizzo email, la password in forma cifrata e tutti i contenuti che crei (vite, visioni,
      viste e collegamenti). L'accesso ai dati è isolato per utente tramite policy di sicurezza a livello di riga
      (Row Level Security): nessun altro utente può leggere o modificare i tuoi contenuti. Supabase può conservare i dati
      su infrastrutture situate anche al di fuori dell'Unione Europea; in tal caso il trasferimento avviene nel rispetto
      delle garanzie previste dal GDPR. Per dettagli vedi la privacy policy di Supabase sul loro sito.</p>
      <p><b>GitHub Pages</b> (GitHub, Inc.) — ospita e distribuisce il codice statico dell'applicazione (i file che il tuo
      browser scarica). GitHub non riceve i contenuti delle tue note, ma può registrare dati tecnici di connessione
      (es. indirizzo IP) per il funzionamento del servizio di hosting.</p>
      <p>Non vendiamo né cediamo i tuoi dati a terzi per finalità di marketing.</p>

      <h2>5. I tuoi diritti</h2>
      <p>Hai diritto di accedere, rettificare, cancellare i tuoi dati, limitarne il trattamento, opporti e richiederne
      la portabilità. Puoi eliminare il tuo account e i relativi contenuti in qualsiasi momento. Puoi inoltre esportare
      in autonomia tutti i tuoi dati in formato JSON tramite la funzione di backup presente nel menu dell'App.</p>

      <h2>6. Cookie e archiviazione locale</h2>
      <p>L'App utilizza l'archiviazione locale del browser per mantenere la sessione, le preferenze (come il tema scelto)
      e, in modalità offline, una copia locale dei tuoi contenuti. Non utilizziamo cookie di profilazione o di terze parti
      per finalità pubblicitarie.</p>

      <h2>7. Modifiche</h2>
      <p>Questa informativa può essere aggiornata. Le modifiche saranno pubblicate in questa pagina.</p>
    </div>
  )
}

export function Terms() {
  return (
    <div className="legal">
      <h1>Termini e Condizioni d'uso</h1>
      <p><em>Ultimo aggiornamento: giugno 2026</em></p>

      <p>Utilizzando uTree accetti i presenti Termini. Se non li accetti, ti preghiamo di non utilizzare l'App.</p>

      <h2>1. Oggetto</h2>
      <p>uTree è un'applicazione per la creazione e l'organizzazione di note gerarchiche
      (vite, visioni, viste) con strumenti di mappatura e produttività.</p>

      <h2>2. Account</h2>
      <p>Sei responsabile della riservatezza delle tue credenziali e di ogni attività svolta tramite il tuo account.
      Devi avere almeno 16 anni o l'età minima prevista nel tuo paese per fornire il consenso al trattamento dei dati.</p>

      <h2>3. Contenuti dell'utente</h2>
      <p>Resti l'unico titolare dei contenuti che crei. Ti impegni a non inserire contenuti illeciti, lesivi di diritti
      altrui o vietati dalla legge. Il titolare non rivendica alcun diritto di proprietà sui tuoi contenuti.</p>

      <h2>4. Disponibilità del servizio</h2>
      <p>L'App è fornita "così com'è". Pur impegnandoci per la continuità del servizio, non garantiamo l'assenza di
      interruzioni o errori. Si consiglia di esportare periodicamente i contenuti importanti tramite la funzione di backup.</p>

      <h2>5. Limitazione di responsabilità</h2>
      <p>Nei limiti consentiti dalla legge, il titolare non è responsabile per perdite di dati, danni indiretti o
      mancati guadagni derivanti dall'uso o dall'impossibilità di usare l'App.</p>

      <h2>6. Proprietà intellettuale</h2>
      <p>Il nome "uTree", il logo, il design e il codice dell'applicazione sono di proprietà di Samuele Contessa
      e protetti dalle leggi sul diritto d'autore.</p>

      <h2>7. Legge applicabile</h2>
      <p>I presenti Termini sono regolati dalla legge italiana. Per ogni controversia è competente il foro del luogo
      di residenza del consumatore, ove previsto dalla normativa applicabile.</p>
    </div>
  )
}
