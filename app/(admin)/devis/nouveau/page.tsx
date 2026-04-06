'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface LigneDevis {
  description: string
  quantite: number
  prix_unitaire: number
  total: number
}

export default function NouveauDevisPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [email, setEmail] = useState('')
  const [adresse, setAdresse] = useState('')
  const [codePostal, setCodePostal] = useState('')
  const [ville, setVille] = useState('')
  const [lignes, setLignes] = useState<LigneDevis[]>([{ description: '', quantite: 1, prix_unitaire: 0, total: 0 }])
  const [tva, setTva] = useState(20)
  const [notes, setNotes] = useState('')

  const montantHT = lignes.reduce((sum, l) => sum + l.total, 0)
  const montantTTC = montantHT * (1 + tva / 100)

  function updateLigne(index: number, field: keyof LigneDevis, value: string | number) {
    const updated = [...lignes]
    const ligne = { ...updated[index] }
    if (field === 'description') { ligne.description = value as string } else { ligne[field] = Number(value) }
    if (field === 'quantite' || field === 'prix_unitaire') { ligne.total = ligne.quantite * ligne.prix_unitaire }
    updated[index] = ligne
    setLignes(updated)
  }

  function addLigne() { setLignes([...lignes, { description: '', quantite: 1, prix_unitaire: 0, total: 0 }]) }
  function removeLigne(index: number) { if (lignes.length === 1) return; setLignes(lignes.filter((_, i) => i !== index)) }

  async function handleSubmit(e: React.FormEvent, sendSMS: boolean = false) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { nom, telephone, email, adresse, code_postal: codePostal, ville },
          devis: { lignes, montant_ht: montantHT, tva, montant_ttc: montantTTC, notes },
          sendSMS,
        }),
      })
      if (!res.ok) throw new Error('Erreur lors de la cr\u00e9ation')
      const data = await res.json()
      router.push(`/devis/${data.devis.id}`)
    } catch (error) { alert('Erreur : ' + (error as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-8">Nouveau devis</h1>
      <form onSubmit={(e) => handleSubmit(e, false)}>
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Client</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label><input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="M. Dupont" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">T\u00e9l\u00e9phone *</label><input type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="06 12 34 56 78" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="dupont@email.fr" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Code postal</label><input type="text" value={codePostal} onChange={(e) => setCodePostal(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="35000" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Ville</label><input type="text" value={ville} onChange={(e) => setVille(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Rennes" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label><input type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="12 rue des Lilas" /></div>
          </div>
        </section>
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Lignes de devis</h2>
          <div className="space-y-3">
            {lignes.map((ligne, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="flex-1"><input type="text" value={ligne.description} onChange={(e) => updateLigne(i, 'description', e.target.value)} placeholder="Ex: Volet roulant alu RAL 7016 - 120x200cm" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="w-20"><input type="number" value={ligne.quantite} onChange={(e) => updateLigne(i, 'quantite', e.target.value)} min={1} className="w-full border rounded-lg px-3 py-2 text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="w-28"><input type="number" value={ligne.prix_unitaire || ''} onChange={(e) => updateLigne(i, 'prix_unitaire', e.target.value)} step="0.01" min={0} placeholder="Prix HT" className="w-full border rounded-lg px-3 py-2 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="w-28 py-2 text-sm text-right font-medium">{ligne.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
                <button type="button" onClick={() => removeLigne(i)} className="p-2 text-red-400 hover:text-red-600 transition-colors">X</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addLigne} className="mt-4 text-blue-600 hover:text-blue-800 text-sm font-medium">+ Ajouter une ligne</button>
          <div className="mt-6 border-t pt-4 flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Total HT</span><span className="font-medium">{montantHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
              <div className="flex justify-between text-sm items-center"><span className="text-gray-500">TVA</span><div className="flex items-center gap-2"><input type="number" value={tva} onChange={(e) => setTva(Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm text-right" step="0.1" /><span className="text-gray-500">%</span></div></div>
              <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total TTC</span><span>{montantTTC.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
            </div>
          </div>
        </section>
        <section className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Notes</h2>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes internes ou remarques pour le client..." className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </section>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-medium disabled:opacity-50">{saving ? 'Enregistrement...' : 'Enregistrer en brouillon'}</button>
          <button type="button" onClick={(e) => handleSubmit(e, true)} disabled={saving || !telephone} className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50">Enregistrer et envoyer par SMS</button>
        </div>
      </form>
    </div>
  )
}
