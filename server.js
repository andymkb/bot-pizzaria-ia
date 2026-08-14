/**
 * Servidor do Bot de WhatsApp com IA Groq (Llama 3.3 70B) + Conexão Supabase
 * PLANO DE CONTAS 5.0 COMPLETO (Mapeamento idêntico à planilha Excel do gestor):
 * - 3.1 RECEITAS (3.1.1 Dinheiro, 3.1.2 Crédito, 3.1.3 Débito, 3.1.4 Pix, 3.1.5 Faturado)
 * - 4.1 IMPOSTOS (4.1.1 Simples Nacional)
 * - 4.2 CMV INSUMOS (4.2.1 Frios, 4.2.4 Bebidas, 4.2.6 Carnes, 4.2.7 Farinhas, 4.2.8 Queijos, 4.2.9 Hortifruti)
 * - 4.3 EMBALAGENS (4.3.1 Caixas e Descartáveis)
 * - 4.4 FRETE & LOGÍSTICA (4.4.1 Frete, 4.4.2 Combustível Motos)
 * - 4.5 TAXAS VARIÁVEIS (4.5.1 iFood/Apps, 4.5.2 Gás Industrial)
 * - 5.1 DESPESAS FINANCEIRAS (5.1.1 Tarifas / Taxas Cartão)
 * - 5.2 OCUPAÇÃO & FIXOS (5.2.1 Internet, 5.2.3 Energia, 5.2.4 Aluguel, 5.2.5 Água, 5.2.11 Contador, 5.2.12 Software)
 * - 5.3 MÃO DE OBRA (5.3.1 Salários, 5.3.5 FGTS, 5.3.6 INSS, 5.3.9 Pró-Labore)
 * - 5.4 MANUTENÇÃO (5.4.1 Equipamentos, 5.4.4 Limpeza)
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xahnpppotcieqdqspvmy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_sw3WY4mg1fX0bNJT6bSDjA_gzBczyB-';

const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

const SYSTEM_PROMPT = `
Você é o Assessor Financeiro DellOS 5.0, um agente especialista em gestão financeira e DRE de pizzarias delivery.

SEU OBJETIVO:
Interpretar dados de despesas, compras de insumos, contas ou vendas informados pelo gestor ou sua sócia (em texto ou áudio) e convertê-los em um registro JSON perfeitamente estruturado segundo o PLANO DE CONTAS OFICIAL DA PIZZARIA.

PLANO DE CONTAS & CLASSIFICAÇÃO DRE:

1. RECEITAS DE VENDAS:
   - 3.1.1 Vendas no Dinheiro
   - 3.1.2 Vendas no Cartão de Crédito
   - 3.1.3 Vendas no Cartão de Débito
   - 3.1.4 Vendas no Pix
   - 3.1.5 Receita Faturado / Canais

2. CUSTOS DE INSUMOS & EMBALAGENS (CMV):
   - 4.2.1 Frios & Embutidos
   - 4.2.4 Bebidas para Revenda
   - 4.2.6 Carnes & Proteínas
   - 4.2.7 Farinhas & Massas
   - 4.2.8 Queijos & Laticínios
   - 4.2.9 Hortifruti & Ingredientes Frescos
   - 4.2.10 Insumos em Geral
   - 4.3.1 Custos com Embalagens (Caixas de Pizza, Sacolas)

3. CUSTOS VARIÁVEIS & LOGÍSTICA:
   - 4.4.1 Frete de Insumos
   - 4.4.2 Combustível Motos / Entregas
   - 4.5.1 Marketplace (Comissões iFood / Aiqfome)
   - 4.5.2 Gás Industrial (Forno / Cozinha)
   - 4.1.1 Impostos sobre Vendas (Simples Nacional)

4. MÃO DE OBRA & PESSOAL:
   - 5.3.1 Salário de Funcionários (Pizzaiolos, Forneiros, Atendentes)
   - 5.3.5 FGTS
   - 5.3.6 INSS / Encargos / VR / VT
   - 5.3.9 Pró-Labore dos Sócios

5. CUSTOS FIXOS & OCUPAÇÃO:
   - 5.1.1 Tarifas Bancárias & Taxas de Cartão
   - 5.2.1 Telefone & Internet
   - 5.2.3 Energia Elétrica
   - 5.2.4 Aluguel + IPTU
   - 5.2.5 Água & Esgoto
   - 5.2.11 Honorários do Contador
   - 5.2.12 Mensalidade de Softwares / Sistemas
   - 5.2.13 Alarme & Segurança
   - 5.4.1 Manutenção Máquinas e Equipamentos
   - 5.4.4 Materiais de Limpeza & Predial

Sua resposta DEVE ser um objeto JSON válido no seguinte formato:
{
  "mensagem_whatsapp": "Texto formatado com emojis em negrito confirmando o código do Plano de Contas e os dados lidos para os sócios",
  "transacao": {
    "tipo": "despesa", // ou "receita"
    "codigo_conta": "4.2.8", // código numérico do Plano de Contas
    "categoria_dre": "CMV_INSUMOS", // 'RECEITA_VENDAS', 'CMV_INSUMOS', 'MAO_DE_OBRA', 'TAXAS_E_VARIAVEIS', 'CUSTOS_FIXOS'
    "subcategoria": "Queijos & Laticínios",
    "fornecedor_canal": "Nome do fornecedor ou canal",
    "valor": 100.00,
    "forma_pagamento": "PIX",
    "status": "Pago", // 'Pago' ou 'A Pagar'
    "requer_confirmacao": true
  }
}
`;

app.get('/', (req, res) => {
  res.send('🍕 DellOS Pizza WhatsApp IA Server - Status: ONLINE (Plano de Contas 5.0 Engine)');
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const rawKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
    
    if (!rawKey) {
      console.error('[Erro] GROQ_API_KEY vazia no Environment do Render.');
      return res.status(500).json({ error: 'GROQ_API_KEY_MISSING' });
    }

    const apiKey = rawKey.trim();
    const payload = req.body;
    const messageData = payload.data || payload;
    const userPhone = messageData.key?.remoteJid || messageData.remoteJid;

    if (!userPhone) return res.status(200).send({ status: 'no_user_phone' });

    // 🛑 BLOQUEIO 1: Ignora conversas privadas individuais (só aceita grupos @g.us)
    const isGroup = userPhone.endsWith('@g.us') || !!messageData.key?.participant;
    if (!isGroup) {
      console.log(`[WhatsApp Ignored Private Chat] Conversa privada ignorada (${userPhone})`);
      return res.status(200).send({ status: 'ignored_private_chat' });
    }

    // 🛑 BLOQUEIO 2: Se o ALLOWED_GROUP_ID estiver configurado, aceita APENAS a mensagem desse grupo exato!
    if (ALLOWED_GROUP_ID && ALLOWED_GROUP_ID.trim() !== '' && userPhone !== ALLOWED_GROUP_ID.trim()) {
      console.log(`[WhatsApp Ignored Unallowed Group] Grupo ${userPhone} não é o autorizado (${ALLOWED_GROUP_ID})`);
      return res.status(200).send({ status: 'ignored_unallowed_group' });
    }

    const messageText = messageData.message?.conversation || 
                        messageData.message?.extendedTextMessage?.text ||
                        messageData.body || '';

    if (!messageText) return res.status(200).send({ status: 'no_text_message' });

    // Trava de segurança contra loops de mensagens enviadas pela própria IA
    if (messageText.includes('Confirmação de Lançamento') || 
        messageText.includes('Venda Registrada') ||
        messageText.includes('Confirmação de compra') ||
        messageText.startsWith('📝') || 
        messageText.startsWith('🍕') || 
        messageText.startsWith('✅')) {
      return res.status(200).send({ status: 'ignored_bot_own_response' });
    }

    console.log(`[WhatsApp Target Group Match 5.0!] Grupo ID: "${userPhone}" | Mensagem: "${messageText}"`);

    // Chamada à API Ultra-Rápida do Groq (Llama 3.3 70B Versatile)
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    
    const requestBody = {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: messageText }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    };

    const groqResponse = await axios.post(groqUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const responseContent = groqResponse.data.choices[0].message.content;
    const parsedJSON = JSON.parse(responseContent);
    console.log('[Groq IA Success Response 5.0]:', parsedJSON);

    // Grava transação diretamente no Banco de Dados Supabase em Nuvem
    try {
      const t = parsedJSON.transacao;
      await axios.post(`${SUPABASE_URL}/rest/v1/transacoes`, {
        tipo: t.tipo || 'despesa',
        categoria_dre: t.categoria_dre || 'CMV_INSUMOS',
        subcategoria: `${t.codigo_conta ? '[' + t.codigo_conta + '] ' : ''}${t.subcategoria || 'Outros'}`,
        fornecedor_canal: t.fornecedor_canal || 'Não informado',
        valor: parseFloat(t.valor) || 0,
        forma_pagamento: t.forma_pagamento || 'Outros',
        mensagem_original: messageText,
        confirmado: true
      }, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      });
      console.log('[Supabase Success 5.0] Transação gravada com SUCESSO no banco SQL!');
    } catch (dbErr) {
      console.error('[Supabase Warning] Erro ao gravar transação no banco:', dbErr.response?.data || dbErr.message);
    }

    // Dispara resposta DE VOLTA NO MESMO GRUPO via Evolution API
    const evoUrl = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-16bcd.up.railway.app';
    const evoKey = process.env.EVOLUTION_API_KEY || 'dellos_pizza_2026';
    const instanceName = process.env.EVOLUTION_INSTANCE || 'PizzariaFinanceiro';

    if (evoUrl) {
      await axios.post(`${evoUrl}/message/sendText/${instanceName}`, {
        number: userPhone,
        text: parsedJSON.mensagem_whatsapp
      }, {
        headers: { 'apikey': evoKey }
      });
      console.log(`[Evolution Send Success] Resposta enviada no Grupo ${userPhone}`);
    }

    return res.status(200).json({ status: 'success', parsed: parsedJSON });

  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('[Erro Webhook Groq Details]:', JSON.stringify(errorDetails));
    return res.status(500).json({ status: 'error', error: errorDetails });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Bot WhatsApp IA (Plano de Contas 5.0) rodando na porta ${PORT}`));
