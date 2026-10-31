pipeline {
    agent {
        node {
            label 'Roboshop'
        }
    }
    environment {
        appVersion = ""
        AWS_ACCOUNT_ID = "104050870679"
        AWS_REGION     = "us-east-1"
        ECR_REPO_NAME  = "roboshop/catalogue"
        ECR_REGISTRY   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    }
    options {
        timeout(time: 5, unit: 'MINUTES')
    } 
    stages {
        stage('Read version') {
            steps {
                script {
                    def packageJson = readJSON file: 'package.json'
                    appVersion = packageJson.version
                    echo "Building version ${appVersion}"
                }
            }
        }
        stage('Install Dependencies') {
            steps {
                script{
                    sh """
                         npm install
                    """     
                }  
            }
        }

        stage('Unit Tests') {
            steps {
                script{
                    sh """
                         npm test
                    """     
                }  
            }
        }

        stage('SonarQube Analysis'){
            steps {
                script {
                    def scannerHome = tool name: 'sonar-8' // agent configuration
                    withSonarQubeEnv('sonar-server') { // analysing and uploading to server
                        sh "${scannerHome}/bin/sonar-scanner"
                    }
            }  }
        }
        stage("Quality Gate") {
            steps {
              timeout(time: 1, unit: 'HOURS') {
                waitForQualityGate abortPipeline: true
              }
            }
        }
        stage('Dependabot Alerts Check') {
            steps {
                withCredentials([string(credentialsId: 'github-token', variable: 'GITHUB_TOKEN')]) {
                    script {
                        def owner = 'ramireddy251'
                        def repo  = 'catalogue-unit-tests'

                        def response = sh(
                            script: """
                                curl -s -w "\\n%{http_code}" \\
                                    -H "Authorization: Bearer ${GITHUB_TOKEN}" \\
                                    -H "Accept: application/vnd.github+json" \\
                                    -H "X-GitHub-Api-Version: 2022-11-28" \\
                                    "https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?severity=high,critical&state=open&per_page=100"
                            """,
                            returnStdout: true
                        ).trim()

                        def parts      = response.tokenize('\n')
                        def httpStatus = parts[-1].trim()
                        def body       = parts[0..-2].join('\n')

                        if (httpStatus != '200') {
                            error "GitHub API call failed with HTTP ${httpStatus}. Check token permissions (security_events scope required).\nResponse: ${body}"
                        }

                        def alerts = readJSON text: body

                        if (alerts.size() == 0) {
                            echo "✅ No HIGH or CRITICAL Dependabot alerts found. Pipeline continues."
                        } else {
                            echo "🚨 Found ${alerts.size()} HIGH/CRITICAL Dependabot alert(s):"
                            alerts.each { alert ->
                                def pkg      = alert.security_vulnerability?.package?.name ?: 'unknown'
                                def severity = alert.security_advisory?.severity?.toUpperCase() ?: 'UNKNOWN'
                                def summary  = alert.security_advisory?.summary ?: 'No summary'
                                def fixedIn  = alert.security_vulnerability?.first_patched_version?.identifier ?: 'No fix available'
                                echo "  ❌ [${severity}] ${pkg} — ${summary} (Fixed in: ${fixedIn})"
                            }
                            error "Pipeline failed: ${alerts.size()} HIGH/CRITICAL Dependabot alert(s) detected."
                        }
                    }
                }
            }
        }
        stage('Build Image') {
            steps {
                sh "docker build -t ${ECR_REPO_NAME}:${appVersion} ."
            }
        }
        stage('Push to ECR') {
            steps {
                // Securely authenticate, tag, and push using AWS CLI and Docker
                sh """
                # 1. Authenticate Docker daemon to ECR registry
                aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}
                
                # 2. Tag the local image with the ECR repository URL
                docker tag ${ECR_REPO_NAME}:${appVersion} ${ECR_REGISTRY}/${ECR_REPO_NAME}:${appVersion}                
                # 3. Push both the versioned tag and 'latest' tag to ECR
                docker push ${ECR_REGISTRY}/${ECR_REPO_NAME}:${appVersion}
                """
            }
        }
    }

    post {
        always {
            echo "I will always say Hello again!"
        }
        success {
            echo "pipeline success"
        }
        failure {
            echo "pipeline failure"
        }
    }
}
