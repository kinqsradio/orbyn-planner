#!/usr/bin/env bash
# Makes the throwaway certificates the end-to-end job's mailbox needs, at setup time; nothing it writes is committed.
# The engine's worker sends mail only over TLS and trusts public CAs only, so the test mailbox (Mailpit) presents a certificate for
# `mailpit` signed by a CA made here, and the worker is told to trust that CA (ORBYN_SMTP_CA_FILE).
#
# Usage: .github/e2e-mail-certs.sh <directory>
# Writes <directory>/ca.pem (the CA to trust), mailpit.pem and mailpit.key (the mailbox's certificate and key). Valid for two days.
set -euo pipefail
dir=${1:?usage: e2e-mail-certs.sh <directory>}
mkdir -p "$dir"
cd "$dir"
rm -f ./*.pem ./*.key ./*.csr ./*.cnf ./*.srl

cat > ca.cnf <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ca
prompt = no
[dn]
CN = Orbyn end-to-end test CA
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -config ca.cnf

cat > server.cnf <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = mailpit
EOF
cat > server.ext <<'EOF'
subjectAltName = DNS:mailpit
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF
openssl req -newkey rsa:2048 -nodes -keyout mailpit.key -out mailpit.csr -config server.cnf
openssl x509 -req -in mailpit.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out mailpit.pem -days 2 -extfile server.ext

# The CA's key is not needed again. The containers read these as other users: they are test files with no value.
rm -f ca.key ./*.csr ./*.cnf ./*.ext ./*.srl
chmod 644 ./*.pem mailpit.key
echo "wrote $dir/ca.pem, $dir/mailpit.pem and $dir/mailpit.key"
