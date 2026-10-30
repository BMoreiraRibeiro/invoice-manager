# Faturas — Gestão pessoal

PWA mobile-first para gestão local de faturas. A aplicação funciona sem backend e mantém os registos no dispositivo através de IndexedDB.

## Incluído nesta fase
- Interface responsiva com navegação entre Dashboard, Nova fatura, Histórico e Exportação.
- Captura através da câmara ou importação de imagem, com pré-visualização local.
- Recorte automático aproximado do papel e OCR local no browser com Tesseract.js em português.
- Leitura dedicada do QR fiscal português, com preenchimento prioritário dos campos estruturados e OCR como complemento.
- Formulário de validação manual com validação de NIF e coerência de valores.
- Persistência local em IndexedDB, dashboard com totais e histórico pesquisável.
- Edição e eliminação de faturas com confirmação.
- Exportação offline para XLSX com todos os registos, intervalo de datas, fornecedor ou seleção individual.
- Tema claro/escuro.
- Indicador de ligação.
- Manifest PWA e ícones.
- Service Worker com cache da estrutura estática.
- Caminhos relativos, compatíveis com publicação em subdiretório do GitHub Pages.

## Ainda não implementado
O OCR e a leitura QR preenchem os campos que conseguirem reconhecer, mas devem ser sempre revistos manualmente. O número aceita os tipos de documento mais comuns (`FT`, `FR`, `FS`, `NC`, `ND` e `RC`) e séries alfanuméricas, por exemplo `FR A/123`. O QR fiscal normalmente transporta NIF do emitente, data, tipo/número do documento, ATCUD, bases/IVA e total; o nome do fornecedor pode continuar a exigir OCR ou confirmação. Na primeira utilização é necessária ligação à Internet para descarregar os motores; fotografias com pouco contraste, papel dobrado ou QR pequeno podem exigir uma nova fotografia mais próxima.

## Testar localmente
O Service Worker exige HTTPS ou localhost. Na pasta do projeto, executar por exemplo:

```bash
python -m http.server 8000
```

Abrir `http://localhost:8000`.

## Publicar no GitHub Pages
1. Criar um repositório GitHub chamado `invoice-manager` (ou outro nome).
2. Colocar o conteúdo desta pasta na raiz do repositório.
3. Abrir **Settings → Pages**.
4. Em Build and deployment, escolher **Deploy from a branch**.
5. Selecionar a branch `main` e a pasta `/ (root)`.
6. Guardar e aguardar a publicação.
7. Abrir o endereço HTTPS indicado pelo GitHub.

Os caminhos da aplicação são relativos e o `scope` do manifest é `./`, para suportar publicação em subdiretório.

## Instalar
- **iPhone:** abrir no Safari → Partilhar → Adicionar ao ecrã principal.
- **Android:** abrir no Chrome → menu → Instalar aplicação / Adicionar ao ecrã principal.

Abrir a aplicação uma primeira vez com Internet para o Service Worker guardar a estrutura base.

## Privacidade
Os dados, imagens e tema escolhido são guardados apenas no armazenamento local do browser. Nenhuma fatura é enviada para serviços externos.
