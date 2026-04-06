'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import SignatureCanvas from 'react-signature-canvas'

interface Devis {
  id: string; reference: string; status: string
  lignes: { description: string; quantite: number; prix_unitaire: number; total: number }[]
  montant_ht: number; tva: number; montant_ttc: number; notes: string
  created_at: string; signed_at: string | null
}

export default function PortailClientPage() {
  const { token } = useParams()
  const [clientNom, setClientNom] = useState('')
  const [devisList, setDevisList] = useState<Devis[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState<string | null>(null)
  const [signatureSubmitting, setSignatureSubmitting] = useState(false)
  const sigCanvas = useRef<SignatureCanvas | null>(null)

  useEffect(() => {
    fetch(`/api/portail/${token}`)
      .then((res) => { if (!res.ok) throw new Error('Lien invalide ou expir\u00e9'); return res.json() })
      .then((data) => { setClientNom(data.client.nom); setDevisList(data.devis) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSign(devisId: string) {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) { alert('Veuillez dessiner votre signature'); return }
    setSignatureSubmitting(true)
    try {
      const signatureData = sigCanvas.current.toDataURL()
      const res = await fetch('/api/signature', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ devis_id: devisId, signature_data: signatureData }) })
      if (!res.ok) throw new Error('Erreur lors de la signature')
      setDevisList((prev) => prev.map((d) => d.id === devisId ? { ...d, status: 'signe', signed_at: new Date().toISOString() } : d))
      setSigning(null)
    } catch (err) { alert((err as Error).message) }
    finally { setSignatureSubmitting(false) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="text-gray-500">Chargement...</div></div>
  if (error) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="bg-white p-8 rounded-xl shadow-sm border text-center"><p className="text-red-600 font-medium">{error}</p><p className="text-gray-500 text-sm mt-2">Ce lien n&apos;est plus valide.</p></div></div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b"><div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between"><div><h1 className="text-xl font-bold text-gray-900">Renov-R</h1><p className="text-sm text-gray-500">Votre espace devis</p></div><p className="text-sm text-gray-600">Bonjour {clientNom}</p></div></header>
      <div className="max-w-3xl mx-auto px-6 py-8">
        {devisList.length === 0 ? <p className="text-gray-500 text-center">Aucun devis disponible.</p> : devisList.map((devis) => (
          <div key={devis.id} className="bg-white rounded-xl shadow-sm border mb-6">
            <div className="p-6 border-b flex items-center justify-between">
              <div><h2 className="font-bold text-lg">Devis {devis.reference}</h2><p className="text-sm text-gray-500">{new Date(devis.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
              {devis.status === 'signe' && <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium">Sign\u00e9</span>}
            </div>
            <div className="p-6">
              <table className="w-full mb-6">
                <thead><tr className="text-left text-sm text-gray-500 border-b"><th className="pb-2">Description</th><th className="pb-2 text-center">Qt\u00e9</th><th className="pb-2 text-right">Prix unit. HT</th><th className="pb-2 text-right">Total HT</th></tr></thead>
                <tbody>{devis.lignes.map((ligne, i) => (
                  <tr key={i} className="border-b last:border-0"><td className="py-3 text-sm">{ligne.description}</td><td className="py-3 text-sm text-center">{ligne.quantite}</td><td className="py-3 text-sm text-right">{ligne.prix_unitaire.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td><td className="py-3 text-sm text-right font-medium">{ligne.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td></tr>
                ))}</tbody>
              </table>
              <div className="flex justify-end"><div className="w-64 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Total HT</span><span>{devis.montant_ht.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">TVA ({devis.tva}%)</span><span>{(devis.montant_ttc - devis.montant_ht).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
                <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total TTC</span><span>{devis.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
              </div></div>
              {devis.notes && <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">{devis.notes}</div>}
            </div>
            {devis.status !== 'signe' && (
              <div className="p-6 border-t bg-gray-50 rounded-b-xl">
                {signing === devis.id ? (
                  <div>
                    <p className="text-sm font-medium mb-3">Dessinez votre signature ci-dessous pour accepter ce devis :</p>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg bg-white mb-3"><SignatureCanvas ref={sigCanvas} canvasProps={{ className: 'w-full h-40', style: { width: '100%', height: '160px' } }} penColor="black" /></div>
                    <div className="flex gap-3">
                      <button onClick={() => sigCanvas.current?.clear()} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100">Effacer</button>
                      <button onClick={() => handleSign(devis.id)} disabled={signatureSubmitting} className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">{signatureSubmitting ? 'Signature en cours...' : 'Valider ma signature'}</button>
                      <button onClick={() => setSigning(null)} className="px-4 py-2 text-gray-500 text-sm hover:text-gray-700">Annuler</button>
                    </div>
                  </div>
                ) : <button onClick={() => setSigning(devis.id)} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 w-full">Signer ce devis</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
