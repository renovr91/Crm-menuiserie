'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Client {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
}

export default function NouveauDevisPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const [reference, setReference] = useState('')
  const [montantHT, setMontantHT] = useState(0)
  const [tva, setTva] = useState(20)
  const [notes, setNotes] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)

  const montantTTC = montantHT * (1 + tva / 100)

  useEffect(() => {
    fetch('/api/clients')
      .then((res) => res.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoadingClients(false))
  }, [])

  const filteredClients = clients.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.nom?.toLowerCase().includes(q) ||
      c.telephone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.ville?.toLowerCase().includes(q)
    )
  })

  function handleSelectClient(client: Client) {
    setSelectedClient(client)
    setSearch('')
  }

  async function handleSubmit(e: React.FormEvent, sendMethod: 'none' | 'sms' | 'email' | 'both' = 'none') {
    e.preventDefault()
    if (!selectedClient) { alert('Veuillez sélectionner un client'); return }
    if (!pdfFile) { alert('Veuillez joindre le PDF du devis'); return }
    if ((sendMethod === 'email' || sendMethod === 'both') && !selectedClient.email) {
      alert('Ce client n\'a pas d\'email enregistré'); return
    }
    if ((sendMethod === 'sms' || sendMethod === 'both') && !selectedClient.telephone) {
      alert('Ce client n\'a pas de téléphone enregistré'); return
    }
    setSaving(true)
    try {
      // 1. Créer le devis en brouillon (on enverra après le PDF upload)
      const res = await fetch('/api/devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: {
            nom: selectedClient.nom,
            telephone: selectedClient.telephone,
            email: selectedClient.email,
            adresse: selectedClient.adresse,
            code_postal: selectedClient.code_postal,
            ville: selectedClient.ville,
          },
          devis: { reference, lignes: [], montant_ht: montantHT, tva, montant_ttc: montantTTC, notes },
          sendSMS: false,
        }),
      })
      if (!res.ok) throw new Error('Erreur lors de la création')
      const data = await res.json()

      // 2. Upload le PDF
      const formData = new FormData()
      formData.append('file', pdfFile)
      formData.append('devis_id', data.devis.id)
      const uploadRes = await fetch('/api/devis/upload-pdf', { method: 'POST', body: formData })
      if (!uploadRes.ok) throw new Error('Erreur upload PDF')

      // 3. Envoyer selon la méthode choisie
      if (sendMethod !== 'none') {
        const sendRes = await fetch(`/api/devis/${data.devis.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: sendMethod }),
        })
        if (!sendRes.ok) {
          const err = await sendRes.json()
          alert('Devis créé mais envoi échoué : ' + (err.error || 'erreur inconnue'))
        }
      }

      router.push(`/devis/${data.devis.id}`)
    } catch (error) { alert('Erreur : ' + (error as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-8">Nouveau devis</h1>
      <form onSubmit={(e) => handleSubmit(e, false)}>

        {/* Sélection client */}
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Client</h2>
            <Link
              href="/clients/nouveau"
              target="_blank"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              + Créer un nouveau client
            </Link>
          </div>

          {!selectedClient ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rechercher un client
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom, téléphone, email ou ville..."
                className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
              />
              <div className="border rounded-lg max-h-80 overflow-y-auto">
                {loadingClients ? (
                  <p className="p-4 text-sm text-gray-500 text-center">Chargement...</p>
                ) : filteredClients.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-gray-500 mb-2">Aucun client trouvé</p>
                    <Link
                      href="/clients/nouveau"
                      target="_blank"
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Créer un nouveau client
                    </Link>
                  </div>
                ) : (
                  filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectClient(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                    >
                      <p className="font-medium text-sm text-gray-900">{c.nom}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {c.telephone || '—'}
                        {c.ville && ` · ${c.ville}`}
                        {c.email && ` · ${c.email}`}
                      </p>
                    </button>
                  ))
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {clients.length} client{clients.length > 1 ? 's' : ''} au total
              </p>
            </div>
          ) : (
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{selectedClient.nom}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedClient.telephone || '—'}
                    {selectedClient.email && ` · ${selectedClient.email}`}
                  </p>
                  {(selectedClient.adresse || selectedClient.ville) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {[selectedClient.adresse, selectedClient.code_postal, selectedClient.ville].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedClient(null)}
                  className="text-sm text-gray-500 hover:text-red-600"
                >
                  Changer
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Devis PDF */}
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Devis</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Référence</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Ex: Menuiseries PVC - Dupont"
              />
            </div>

            {/* Upload PDF */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">PDF du devis *</label>
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${pdfFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}
                onClick={() => document.getElementById('pdf-input')?.click()}
              >
                {pdfFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <div className="text-left">
                      <p className="font-medium text-green-800">{pdfFile.name}</p>
                      <p className="text-xs text-green-600">{(pdfFile.size / 1024).toFixed(0)} Ko</p>
                    </div>
                    <button type="button" onClick={(ev) => { ev.stopPropagation(); setPdfFile(null) }} className="ml-4 text-red-400 hover:text-red-600 text-sm">Supprimer</button>
                  </div>
                ) : (
                  <div>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-gray-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <p className="text-gray-600 font-medium">Cliquez pour joindre le PDF</p>
                    <p className="text-xs text-gray-400 mt-1">ou glissez-déposez le fichier ici</p>
                  </div>
                )}
                <input id="pdf-input" type="file" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]) }} />
              </div>
            </div>

            {/* Montants */}
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Montant HT *</label><input type="number" value={montantHT || ''} onChange={(e) => setMontantHT(Number(e.target.value))} step="0.01" min={0} required className="w-full border rounded-lg px-3 py-2 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="0.00" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">TVA %</label><input type="number" value={tva} onChange={(e) => setTva(Number(e.target.value))} step="0.1" className="w-full border rounded-lg px-3 py-2 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Total TTC</label><div className="border rounded-lg px-3 py-2 text-sm text-right bg-gray-50 font-bold">{montantTTC.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div></div>
            </div>
          </div>
        </section>

        {/* Notes */}
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Notes</h2>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes internes ou remarques..." className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </section>

        {/* Boutons */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={(e) => handleSubmit(e, 'none')}
            disabled={saving || !pdfFile || !selectedClient}
            className="bg-gray-600 text-white px-5 py-2.5 rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Brouillon'}
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e, 'sms')}
            disabled={saving || !selectedClient?.telephone || !pdfFile}
            title={!selectedClient?.telephone ? 'Ce client n\'a pas de téléphone' : undefined}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            Envoyer par SMS
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e, 'email')}
            disabled={saving || !selectedClient?.email || !pdfFile}
            title={!selectedClient?.email ? 'Ce client n\'a pas d\'email' : undefined}
            className="bg-purple-600 text-white px-5 py-2.5 rounded-lg hover:bg-purple-700 transition-colors font-medium text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Envoyer par Email
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e, 'both')}
            disabled={saving || !selectedClient?.telephone || !selectedClient?.email || !pdfFile}
            title={!selectedClient?.telephone || !selectedClient?.email ? 'Client doit avoir téléphone ET email' : undefined}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-5 py-2.5 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all font-medium text-sm disabled:opacity-50 flex items-center gap-2"
          >
            SMS + Email
          </button>
        </div>
      </form>
    </div>
  )
}
