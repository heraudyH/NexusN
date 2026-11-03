/* =====================================================================
   NEXUS NUMÉRIQUE — Réglages de l'application de gestion
   Modifiez ce fichier pour changer les informations qui apparaissent
   sur les devis PDF. Ne mettez JAMAIS ici la clé "service_role".
   (La clé "publishable" ci-dessous est publique par conception : la
   sécurité est assurée par les règles de la base de données.)
   ===================================================================== */
window.NEXUS_CONFIG = {
  SUPABASE_URL: "https://eooqdjmjolslekshqsrd.supabase.co",
  SUPABASE_KEY: "sb_publishable_QhksrXupIOFqUHMTFmpx8g_mgjcgNPZ",

  // Informations affichées en en-tête des devis PDF
  COMPANY: {
    name: "NEXUS NUMÉRIQUE",
    tagline: "Impression et flocage textile personnalisé",
    address: "Koffikro",
    phone: "+225 05 02 08 06 49",
    email: ""
  },

  // Valeurs proposées par défaut à la création d'un devis (modifiables devis par devis)
  QUOTE_VALIDITY_DAYS: 15,
  DELIVERY_DEFAULT: "À confirmer selon la quantité",

  // Texte imprimé dans « Conditions » sur le devis PDF
  PAYMENT_TERMS: "Acompte à la commande, solde à la livraison."
};
