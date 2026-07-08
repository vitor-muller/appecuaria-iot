require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "access",
  clientId: process.env.COGNITO_CLIENT_ID,
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Conectado ao Mongo Atlas!'))
  .catch(err => console.error('Erro ao conectar:', err));

const PesagemAutomaticaSchema = new mongoose.Schema({
  rfidAnimal: { type: String, required: true },
  pesoKg: { type: Number, required: true },
  donoId: { type: String, required: true },
  dataHoraLeitura: { type: Date, default: Date.now }
});

const PesagemAutomatica = mongoose.model('PesagemAutomatica', PesagemAutomaticaSchema);

const autenticarCognito = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token inválido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = await verifier.verify(token);
    req.usuario = payload;
    next();
  } catch (err) {
    console.error("Token inválido:", err);
    return res.status(401).json({ erro: 'Token inválido.' });
  }
};


async function enviarParaRabbitMQ(dadosPesagem) {
  try {
    const rabbitUrl = process.env.RABBITMQ_URI || 'amqp://guest:guest@rabbitmq:5672';
    const conexao = await amqp.connect(rabbitUrl);
    const canal = await conexao.createChannel();

    const exchange = 'sensor_exchange';
    const tipo = 'topic';
    
    const routingKey = `sensor.pesagem.${dadosPesagem.donoId}`; 

    await canal.assertExchange(exchange, tipo, { durable: true });

    const mensagem = JSON.stringify(dadosPesagem);
    canal.publish(exchange, routingKey, Buffer.from(mensagem));

    console.log(`Mensagem enviada com routing key '${routingKey}':`, mensagem);

    setTimeout(() => {
      conexao.close();
    }, 500);

  } catch (erro) {
    console.error('Erro no RabbitMQ:', erro);
  }
}

app.post('/pesagem', autenticarCognito, async (req, res) => {
  try {
    const { rfidAnimal, pesoKg } = req.body;

    if (!rfidAnimal || !pesoKg) {
      return res.status(400).json({ erro: 'Os campos rfidAnimal e pesoKg são obrigatórios.' });
    }

    const dadosPesagem = {
      rfidAnimal,
      pesoKg,
      donoId: req.usuario.sub,
      dataHoraLeitura: new Date()
    };

    await enviarParaRabbitMQ(dadosPesagem);

    const novaPesagem = new PesagemAutomatica(dadosPesagem);
    novaPesagem.save().catch(err => console.error("Erro ao salvar no Mongo:", err));

    return res.status(202).json({
      mensagem: 'Pesagem recebida e enviada para processamento!',
      dados: dadosPesagem
    });

  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao receber a pesagem.' });
  }
});

app.get('/pesagem', autenticarCognito, async (req, res) => {
  try {
    const pesagens = await PesagemAutomatica.find({ donoId: req.usuario.sub })
                                            .sort({ dataHoraLeitura: -1 });

    return res.status(200).json(pesagens);
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao buscar as pesagens.' });
  }
});

app.put('/pesagem/:id', autenticarCognito, async (req, res) => {
  try {
    const { id } = req.params;
    const { rfidAnimal, pesoKg } = req.body;

    const pesagemAtualizada = await PesagemAutomatica.findOneAndUpdate(
      { _id: id, donoId: req.usuario.sub },
      { rfidAnimal, pesoKg },
      { new: true, runValidators: true } 
    );

    if (!pesagemAtualizada) {
      return res.status(404).json({ erro: 'Pesagem não encontrada.' });
    }

    return res.status(200).json({
      mensagem: 'Pesagem atualizada com sucesso!',
      dados: pesagemAtualizada
    });

  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao atualizar a pesagem.' });
  }
});

app.delete('/pesagem/:id', autenticarCognito, async (req, res) => {
  try {
    const { id } = req.params;

    const pesagemDeletada = await PesagemAutomatica.findOneAndDelete({
      _id: id,
      donoId: req.usuario.sub
    });

    if (!pesagemDeletada) {
      return res.status(404).json({ erro: 'Pesagem não encontrada.' });
    }

    return res.status(200).json({ mensagem: 'Pesagem excluída com sucesso!' });

  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao excluir a pesagem.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});