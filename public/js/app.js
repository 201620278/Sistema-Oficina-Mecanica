class NegoCarSystem {
    constructor() {
        this.init();
        this.configurarEventListeners();
    }

    async init() {
        try {
            await this.carregarDados();
            this.atualizarTodosDados();
        } catch (error) {
            console.error('Erro ao inicializar sistema:', error);
        }
    }

    async carregarDados() {
        const [clientes, agendamentos, orcamentos] = await Promise.all([
            fetch('/api/clientes').then(res => res.json()),
            fetch('/api/agendamentos').then(res => res.json()),
            fetch('/api/orcamentos').then(res => res.json())
        ]);

        state.clientes = clientes;
        state.agendamentos = agendamentos;
        state.orcamentos = orcamentos;
    }

    configurarEventListeners() {
        // Form Cliente
        const formCliente = document.getElementById('form-cliente');
        if (formCliente) {
            formCliente.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.salvarCliente();
            });
        }
    }

    async salvarCliente() {
        try {
            const nome = document.getElementById('cliente-nome').value;
            const telefone = document.getElementById('cliente-telefone').value.replace(/\D/g, '');

            if (!nome || !telefone) {
                alert('Nome e telefone são obrigatórios!');
                return;
            }

            // Validar telefone duplicado
            if (!state.clienteEmEdicao && state.clientes.some(c => c.telefone === telefone)) {
                alert('Este número de telefone já está cadastrado!');
                return;
            }

            const dados = {
                id: Date.now(),
                nome,
                telefone,
                endereco: {
                    cep: document.getElementById('cliente-cep').value,
                    rua: document.getElementById('cliente-rua').value,
                    numero: document.getElementById('cliente-numero').value,
                    bairro: document.getElementById('cliente-bairro').value,
                    cidade: document.getElementById('cliente-cidade').value
                },
                veiculos: [],
                ativo: true
            };

            // Coletar veículos (opcional)
            const veiculoElements = document.querySelectorAll('.veiculo-item');
            for (const element of veiculoElements) {
                const placa = element.querySelector('.veiculo-placa')?.value?.toUpperCase();
                if (placa) {
                    // Validar placa duplicada
                    if (state.clientes.some(c => c.veiculos.some(v => v.placa === placa))) {
                        alert(`A placa ${placa} já está cadastrada!`);
                        return;
                    }

                    dados.veiculos.push({
                        placa,
                        marca: element.querySelector('.veiculo-marca').value,
                        modelo: element.querySelector('.veiculo-modelo').value,
                        ano: element.querySelector('.veiculo-ano').value,
                        ativo: true
                    });
                }
            }

            // Adicionar ou atualizar cliente
            if (state.clienteEmEdicao) {
                const index = state.clientes.findIndex(c => c.id === state.clienteEmEdicao.id);
                if (index !== -1) {
                    state.clientes[index] = { ...state.clienteEmEdicao, ...dados };
                }
            } else {
                state.clientes.push(dados);
            }

            // Salvar no localStorage
            this.saveToStorage('clientes', state.clientes);

            // Atualizar interface
            this.atualizarTodosDados();

            // Limpar formulário
            this.limparFormularioCliente();

            // Fechar modal
            fecharModalCliente();

            alert('Cliente salvo com sucesso!');

        } catch (error) {
            console.error('Erro ao salvar cliente:', error);
            alert('Erro ao salvar cliente. Tente novamente.');
        }
    }

    limparFormularioCliente() {
        document.getElementById('cliente-nome').value = '';
        document.getElementById('cliente-telefone').value = '';
        document.getElementById('cliente-cep').value = '';
        document.getElementById('cliente-rua').value = '';
        document.getElementById('cliente-numero').value = '';
        document.getElementById('cliente-bairro').value = '';
        document.getElementById('cliente-cidade').value = '';

        // Limpar veículos
        const container = document.getElementById('veiculos-container');
        container.innerHTML = '';
        window.veiculoCount = 0;
        adicionarVeiculo();
    }
}

// Certifique-se de que o sistema seja inicializado corretamente
document.addEventListener('DOMContentLoaded', () => {
    window.sistema = new NegoCarSystem();
});