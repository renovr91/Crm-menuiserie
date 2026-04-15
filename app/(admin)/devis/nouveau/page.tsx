'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NouveauDevisPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [email, setEmail] = useState('')
  const [adresse, setAdresse] = useState('')
  const [codePostal, setCodePostal] = useState('')
  const [ville, setVille] = useState('')
  const [reference, setReference] = useState('')
  const [montantHT, setMontantHT] = useState(0)
  const [tva, setTva] = useState(20)
  const [notes, setNotes] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)

  const montantTTC = montantHT * (1 + tva / 100)

  async function handleSubmit(e: React.FormEvent, sendSMS: boolean = false) {
    e.preventDefault()
    if (!pdfFile) { alert('Veuillez joindre le PDF du devis'); return }
    setSaving(true)
    try {
      // 1. Créer le devis
      const res = await fetch('/api/devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { nom, telephone, email, adresse, code_postal: codePostal, ville },
          devis: { reference, lignes: [], montant_ht: montantHT, tva, montant_ttc: montantTTC, notes },
          sendSMS,
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

      router.push(`/devis/${data.devis.id}`)
    } catch (error) { alert('Erreur : ' + (error as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-8">Nouveau devis</h1>
      <form onSubmit={(e) => handleSubmit(e, false)}>
        {/* Client */}
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Client</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label><input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="M. Dupont" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Téléphone *</label><input type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="06 12 34 56 78" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="dupont@email.fr" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Code postal</label><input type="text" value={codePostal} onChange={(e) => setCodePostal(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="91100" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Ville</label><input type="text" value={ville} onChange={(e) => setVille(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Corbeil" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label><input type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="12 rue des Lilas" /></div>
          </div>
        </section>

        {/* Devis PDF */}
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Devis</h2>
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Référence</label><input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Ex: Menuiseries PVC - Dupont" /></div>

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
        <div className="flex gap-3">
          <button type="submit" disabled={saving || !pdfFile} className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-medium disabled:opacity-50">{saving ? 'Enregistrement...' : 'Enregistrer en brouillon'}</button>
          <button type="button" onClick={(e) => handleSubmit(e, true)} disabled={saving || !telephone || !pdfFile} className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50">Enregistrer et envoyer par SMS</button>
        </div>
      </form>
    </div>
  )
}
