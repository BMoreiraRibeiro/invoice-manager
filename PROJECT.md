# Projeto: PWA de Leitura e Gestão de Faturas

## 1. Objetivo

Quero desenvolver uma aplicação Web Progressiva (PWA) para gestão pessoal de faturas, compatível com Android e iOS, sem necessidade de publicar na Google Play Store ou Apple App Store.

A aplicação deverá ser alojada gratuitamente no GitHub Pages e instalada nos dispositivos através da funcionalidade "Adicionar ao ecrã principal".

O objetivo principal é permitir fotografar ou importar faturas, reconhecer automaticamente os seus dados através de OCR, guardar a informação localmente e exportar os registos para Excel.

A aplicação será utilizada exclusivamente por mim, prevendo um volume máximo de aproximadamente 50 faturas por mês.

## 2. Requisitos técnicos e arquitetura

A aplicação deverá respeitar os seguintes requisitos:

- Ser uma PWA instalável em Android e iOS.
- Ser compatível com Safari no iPhone e Chrome no Android.
- Ser alojada no GitHub Pages.
- Não necessitar de backend, servidor próprio ou serviços externos pagos.
- Todo o processamento deverá ocorrer localmente no dispositivo.
- Não enviar fotografias ou dados das faturas para serviços externos.
- Funcionar offline depois da primeira instalação e carregamento dos recursos necessários.
- Guardar os dados localmente no dispositivo.
- Permitir exportar os dados para um ficheiro Excel (.xlsx).

### Tecnologias sugeridas

Dar preferência às seguintes tecnologias:

- HTML5, CSS3 e JavaScript ou TypeScript.
- IndexedDB para armazenamento persistente dos dados.
- Service Worker para funcionamento offline.
- Web App Manifest para instalação como PWA.
- Tesseract.js para reconhecimento OCR local.
- SheetJS (xlsx) para criação dos ficheiros Excel.
- APIs nativas do browser para acesso à câmara e seleção de imagens.

Poderão ser utilizadas outras bibliotecas gratuitas caso apresentem vantagens técnicas claras.

Evitar dependências desnecessárias e serviços que exijam subscrições.

## 3. Funcionalidades principais

### 3.1. Dashboard

Criar um ecrã inicial com:

- Número total de faturas registadas.
- Total de despesas.
- Total de IVA.
- Número de faturas por mês.
- Acesso rápido à captura de uma nova fatura.
- Acesso ao histórico.
- Acesso à exportação Excel.

A interface deverá ser simples, moderna e adaptada a dispositivos móveis.

### 3.2. Captura de faturas

Permitir duas formas de introdução:

1. Tirar uma fotografia diretamente através da câmara do dispositivo.
2. Importar uma imagem existente, preferencialmente JPG, JPEG ou PNG.

Deverá ser possível:

- Visualizar a imagem antes do processamento.
- Repetir a fotografia.
- Selecionar outra imagem.
- Corrigir ou recortar a imagem, se necessário.
- Processar a imagem através do OCR.

Ter em atenção as particularidades do Safari no iOS relativamente ao acesso à câmara.

### 3.3. Reconhecimento OCR

Implementar reconhecimento de texto totalmente local.

O motor OCR deverá suportar, pelo menos, o idioma português.

O reconhecimento deverá procurar identificar os seguintes campos:

| Campo | Descrição |
|---|---|
| Número da fatura | Identificador do documento |
| Data da fatura | Data de emissão |
| Nome do fornecedor | Nome da empresa emissora |
| NIF do fornecedor | Número de identificação fiscal |
| Base tributável | Valor sem IVA |
| Valor do IVA | Total do imposto |
| Total da fatura | Valor final a pagar |

O reconhecimento deverá tentar identificar os campos através de palavras-chave, contexto e proximidade dos valores no documento.

Exemplos de palavras-chave:

- TOTAL
- TOTAL A PAGAR
- VALOR TOTAL
- IVA
- BASE TRIBUTÁVEL
- CONTRIBUINTE
- NIF
- DATA
- FATURA
- FATURA-RECIBO

Não assumir que todas as faturas possuem a mesma estrutura.

É importante evitar confundir:
- Total da fatura com subtotal.
- Valor do IVA com base tributável.
- Total pago com total a pagar.
- Número de contribuinte do fornecedor com o do cliente.

O reconhecimento deverá indicar os campos que não conseguiu identificar com confiança.

### 3.4. Validação manual

Depois do OCR, apresentar um formulário com os dados reconhecidos.

O utilizador deverá poder:

- Corrigir qualquer campo.
- Preencher manualmente os campos não reconhecidos.
- Confirmar os valores.
- Cancelar o registo.
- Visualizar a fotografia original.

A aplicação nunca deverá guardar automaticamente uma fatura como validada sem confirmação do utilizador.

Implementar validações básicas, incluindo:
- Formato da data.
- Formato do NIF português.
- Valores monetários.
- Coerência entre base tributável, IVA e total, tendo em conta eventuais outros encargos, descontos ou impostos.

### 3.5. Histórico de faturas

Criar uma área de consulta com todas as faturas registadas.

Funcionalidades:

- Listagem de faturas.
- Pesquisa por fornecedor.
- Pesquisa por NIF.
- Pesquisa por número de fatura.
- Filtro por período.
- Filtro por estado de validação.
- Ordenação por data.
- Visualização dos detalhes de uma fatura.
- Edição de faturas existentes.
- Eliminação de faturas, mediante confirmação.

Permitir visualizar a imagem original, caso tenha sido guardada.

Adicionar a possibilidade de selecionar individualmente uma ou várias faturas através de caixas de seleção, para permitir a sua exportação seletiva para Excel.

### 3.6. Exportação Excel

Implementar exportação para ficheiros Excel (.xlsx).

A exportação deverá disponibilizar quatro modalidades independentes:

**1. Exportar todas as faturas**

Permitir exportar todos os registos existentes na base de dados.

**2. Exportar por intervalo de datas**

Permitir selecionar uma data inicial e uma data final.

Exportar apenas as faturas cuja data de emissão esteja compreendida no intervalo selecionado, incluindo ambas as datas.

**3. Exportar por fornecedor**

Permitir selecionar um fornecedor através de uma lista dos fornecedores existentes na base de dados.

Exportar todas as faturas correspondentes ao fornecedor selecionado.

A identificação deverá ser feita preferencialmente pelo NIF do fornecedor, evitando confusões entre empresas com nomes semelhantes.

**4. Exportar faturas individuais**

Permitir selecionar uma ou várias faturas específicas através de caixas de seleção no histórico.

Exportar exclusivamente as faturas selecionadas.

### Interface de exportação

Criar uma área própria para exportação, com uma interface simples e intuitiva.

O utilizador deverá conseguir escolher a modalidade de exportação e definir os respetivos parâmetros.

Antes de gerar o ficheiro, apresentar:

- Modalidade de exportação selecionada.
- Intervalo de datas, quando aplicável.
- Fornecedor selecionado, quando aplicável.
- Número de faturas que serão exportadas.
- Total monetário das faturas selecionadas.

Disponibilizar um botão para confirmar e gerar o ficheiro Excel.

Os filtros deverão funcionar independentemente uns dos outros, sem alterar ou eliminar os registos originais da base de dados.

### Estrutura do ficheiro Excel

O ficheiro deverá ter uma folha chamada "Faturas", com as seguintes colunas:

1. Número da fatura.
2. Data.
3. Fornecedor.
4. NIF.
5. Base tributável.
6. IVA.
7. Total.

Adicionar:

- Cabeçalhos formatados.
- Filtros automáticos.
- Formatação de datas.
- Formatação monetária em EUR.
- Linha de totais no final.
- Colunas com largura ajustada ao conteúdo.
- Nome do ficheiro identificativo da exportação e da data de geração.

O ficheiro deverá poder ser descarregado ou partilhado através das funcionalidades disponíveis no dispositivo.

A exportação deverá funcionar completamente offline.

## 4. Armazenamento e privacidade

Utilizar IndexedDB como armazenamento principal.

Os dados deverão permanecer exclusivamente no dispositivo.

Não utilizar:
- Firebase.
- Supabase.
- APIs externas de OCR.
- Serviços cloud de inteligência artificial.
- Bases de dados remotas.

A aplicação deverá permitir exportar os dados para Excel como mecanismo de cópia de segurança.

Considerar também a possibilidade de implementar uma funcionalidade de exportação e importação de cópia de segurança completa, incluindo os registos e, opcionalmente, as fotografias.

Implementar tratamento de erros e evitar a perda de dados quando a aplicação é fechada ou atualizada.

## 5. PWA e funcionamento offline

Criar todos os elementos necessários para uma PWA:

- manifest.json.
- service-worker.js.
- Ícones da aplicação.
- Nome e nome abreviado.
- Tema e cores.
- Configuração de instalação.
- Estratégia de cache.

A aplicação deverá funcionar offline depois de ter sido aberta e preparada pela primeira vez.

É especialmente importante garantir que:

- O JavaScript da aplicação fica disponível offline.
- O motor OCR fica disponível offline.
- Os ficheiros de idioma português do OCR são armazenados localmente.
- A exportação Excel funciona offline.
- Os dados guardados continuam disponíveis sem ligação à Internet.

Ter em atenção que o GitHub Pages poderá publicar a aplicação num subdiretório do repositório. Todos os caminhos para recursos, manifest e service worker deverão funcionar corretamente nesse cenário.

## 6. Interface e experiência de utilização

Pretendo uma interface moderna, minimalista e profissional.

Requisitos:

- Mobile-first.
- Compatível com ecrãs de diferentes dimensões.
- Navegação simples.
- Botões adequados à utilização por toque.
- Formulários claros.
- Indicadores de processamento OCR.
- Mensagens de erro compreensíveis.
- Confirmações antes de eliminar dados.
- Suporte para tema claro e escuro, se não complicar excessivamente a implementação.

A aplicação deverá ter aspeto de uma aplicação móvel e não de um website tradicional.

## 7. Compatibilidade

Dar prioridade aos seguintes ambientes:

- iPhone com Safari.
- Android com Chrome.
- Instalação através de "Adicionar ao ecrã principal".
- GitHub Pages como alojamento.

Não utilizar funcionalidades que dependam exclusivamente de APIs disponíveis em Chrome ou Android sem apresentar alternativas para Safari.

Ter especial atenção a:

- IndexedDB no iOS.
- Persistência dos dados.
- Gestão de memória durante o OCR.
- Permissões da câmara.
- Service Workers.
- Download e partilha de ficheiros Excel.
- Instalação da PWA no iOS.

## 8. Estrutura do projeto

Organizar o código de forma modular, separando responsabilidades.

Exemplo de estrutura:

```text
invoice-manager/
│
├── index.html
├── manifest.json
├── service-worker.js
│
├── assets/
│   ├── icons/
│   └── images/
│
├── css/
│   ├── style.css
│   └── responsive.css
│
├── js/
│   ├── app.js
│   ├── database.js
│   ├── camera.js
│   ├── image-processing.js
│   ├── ocr.js
│   ├── invoice-parser.js
│   ├── invoice-manager.js
│   └── excel-export.js
│
└── README.md
```

A estrutura poderá ser ajustada caso seja utilizada uma ferramenta de build ou framework.

## 9. Estratégia de desenvolvimento

Não desenvolver tudo de uma só vez.

Dividir o trabalho em fases:

**Fase 1 — Estrutura base**

- Criar a interface.
- Configurar a PWA.
- Preparar o GitHub Pages.
- Implementar a navegação.

**Fase 2 — Captura e OCR**

- Implementar acesso à câmara.
- Implementar importação de imagens.
- Integrar Tesseract.js.
- Garantir processamento offline.
- Testar com faturas reais portuguesas.

**Fase 3 — Interpretação**

- Desenvolver o parser de faturas.
- Identificar os campos pretendidos.
- Implementar validações.
- Criar formulário de confirmação.

**Fase 4 — Base de dados**

- Implementar IndexedDB.
- Criar histórico.
- Implementar pesquisa, filtros, edição e eliminação.
- Implementar seleção individual de faturas.

**Fase 5 — Excel**

- Implementar exportação XLSX.
- Implementar exportação de todas as faturas.
- Implementar exportação por intervalo de datas.
- Implementar exportação por fornecedor.
- Implementar exportação de faturas individuais ou selecionadas.
- Implementar pré-visualização dos registos a exportar.
- Testar a exportação em Android e iOS.

**Fase 6 — Testes e publicação**

- Testar no Safari e Chrome.
- Testar instalação como PWA.
- Testar funcionamento offline.
- Testar persistência dos dados.
- Testar a exportação e importação de cópias de segurança.
- Publicar no GitHub Pages.

## 10. Regras importantes de desenvolvimento

- Não implementar funcionalidades fictícias ou apenas visuais.
- Todos os botões deverão executar a ação correspondente.
- Não utilizar dados de exemplo como se fossem dados reais.
- Não enviar dados das faturas para a Internet.
- Não introduzir dependências pagas sem aprovação.
- Manter o código organizado e comentado onde necessário.
- Tratar erros de forma adequada.
- Evitar alterar funcionalidades já implementadas sem necessidade.
- Explicar as alterações efetuadas em cada fase.
- Fornecer sempre os ficheiros completos e indicar onde devem ser colocados.
- Não avançar para a fase seguinte sem validar a fase atual.

## 11. Primeiro pedido

Antes de começar a implementar todas as funcionalidades, apresenta:

1. A arquitetura técnica definitiva.
2. As bibliotecas gratuitas a utilizar.
3. A estrutura de ficheiros.
4. As limitações conhecidas do Safari no iOS.
5. A estratégia para garantir funcionamento offline.
6. A estratégia de armazenamento e segurança dos dados.
7. A estratégia de exportação Excel e os quatro modos de seleção.

Depois desta análise, começa pela Fase 1.

O resultado final deverá ser uma aplicação funcional, instalável em Android e iOS através de PWA, alojada no GitHub Pages, capaz de fotografar faturas, reconhecer os seus dados localmente, permitir validação manual, guardar o histórico e exportar os dados para Excel, com possibilidade de selecionar todas as faturas, um intervalo de datas, um fornecedor ou faturas individuais.