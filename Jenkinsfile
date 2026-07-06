pipeline {
    agent any


    environment {
        COMPOSE_FILE = "docker-compose.yml"
        NETWORK_NAME = "appnet"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Verificar Network') {
            steps {
                sh '''
                if ! docker network ls --format '{{.Name}}' | grep -w $NETWORK_NAME; then
                echo "Criando rede $NETWORK_NAME..."
                docker network create $NETWORK_NAME
                else
                echo "Rede $NETWORK_NAME já existe."
                fi
                '''
            }
        }

        stage('Build') {
            steps {
                sh '''
                docker compose -f $COMPOSE_FILE build
                '''
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                docker compose -f $COMPOSE_FILE up -d
                '''
            }
        }
    }

    post {
        success {
            echo 'Deploy realizado com sucesso!'
        }
        failure {
            echo 'Erro no pipeline!'
        }
    }

}