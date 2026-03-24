variable "project_name" {
  description = "Base name for all resources."
  type        = string
  default     = "team-activity-monitor"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "staging"
}

variable "aws_region" {
  description = "AWS region for deployment."
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "Availability zones for multi-AZ deployment."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "vpc_cidr" {
  description = "CIDR block for the application VPC."
  type        = string
  default     = "10.30.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet ranges."
  type        = list(string)
  default     = ["10.30.0.0/20", "10.30.16.0/20"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet ranges."
  type        = list(string)
  default     = ["10.30.64.0/20", "10.30.80.0/20"]
}

variable "app_port" {
  description = "Port exposed by the container."
  type        = number
  default     = 3000
}

variable "app_cpu" {
  description = "Fargate CPU units."
  type        = number
  default     = 512
}

variable "app_memory" {
  description = "Fargate memory in MiB."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired ECS task count."
  type        = number
  default     = 2
}

variable "container_image" {
  description = "Container image URI to deploy."
  type        = string
  default     = "public.ecr.aws/docker/library/node:20-alpine"
}

variable "app_base_url" {
  description = "Public base URL for the deployed app."
  type        = string
  default     = "https://example.com"
}

variable "session_secret_name" {
  description = "Secrets Manager name for the session secret."
  type        = string
  default     = "tam/session-secret"
}

variable "jira_secret_name" {
  description = "Secrets Manager name for Jira credentials."
  type        = string
  default     = "tam/jira"
}

variable "github_secret_name" {
  description = "Secrets Manager name for GitHub credentials."
  type        = string
  default     = "tam/github"
}

variable "db_allocated_storage" {
  description = "Allocated Postgres storage in GiB."
  type        = number
  default     = 20
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Application database name."
  type        = string
  default     = "tamapp"
}

variable "db_username" {
  description = "Database master username."
  type        = string
  default     = "tamadmin"
}

variable "db_password" {
  description = "Database master password."
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}
